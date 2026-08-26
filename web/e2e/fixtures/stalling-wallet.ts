import type {Page} from '@playwright/test';

/**
 * A wallet that HOLDS a transaction request until the test lets it go.
 *
 * WHY THE SUITE NEEDED THIS. Every other e2e drives the burner wallet, which
 * answers instantly and, worse, is deliberately suppressed from the "Wallet
 * Action Required" prompt (see `isBurnerWalletInSelectionPhase` and
 * `work/notes/observations/wallet-action-required-modal-not-seen.md`). So the
 * entire window this app's in-flight machinery exists for, between dispatching
 * `eth_sendTransaction` and hearing back, could not be entered by a test at all.
 * A bug that lost a real transaction in that window shipped past 40 e2e tests
 * and 581 unit tests because nothing could stand in it long enough to click.
 *
 * This is a real EIP-6963 wallet as far as the app is concerned: it announces
 * itself, answers reads by forwarding them to the node, and signs nothing it
 * does not have to. The one difference is that `eth_sendTransaction` parks until
 * {@link approveTransaction} is called, and then really is forwarded, so the
 * transaction genuinely lands on chain and everything downstream is real.
 *
 * The node's accounts are unlocked (hardhat), so forwarding is enough and the
 * fixture needs no key material.
 */

export const STALLING_WALLET_NAME = 'Stalling Test Wallet';

/**
 * The accounts it can sign as, ONE PER SUITE.
 *
 * Hardhat's #9 and #8, chosen to sit well clear of both lists that matter:
 * `e2e/impersonate-addresses.json` (what the burner offers, one per suite that
 * sends) and anything in the env files. Two suites sending from one account race
 * for its nonce, and that surfaces as an unrelated test failing on a transaction
 * that never appeared.
 *
 * A POOL RATHER THAN ONE ADDRESS, because this fixture is the only way into the
 * window between dispatch and answer, so more than one suite legitimately wants
 * it. It was a single account while one suite used it, and the second suite
 * turned that into a nonce race; `test/e2e-account-claims.test.ts` now checks
 * the claims here the same way it checks `walletAccountIndex` for burners.
 */
export const STALLING_WALLET_ACCOUNTS = [
	'0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
	'0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
] as const;

/** The default account, for a suite that does not ask for a particular one. */
export const STALLING_WALLET_ACCOUNT = STALLING_WALLET_ACCOUNTS[0];

/**
 * Install the wallet before any app code runs.
 *
 * Must be called before the page navigates: the app listens for
 * `eip6963:announceProvider` during startup, and a wallet that announces itself
 * after that is simply not there.
 */
export async function installStallingWallet(
	page: Page,
	options: {
		nodeUrl: string;
		/**
		 * Which of {@link STALLING_WALLET_ACCOUNTS} this suite signs as. One suite
		 * per index: the claim is checked by `test/e2e-account-claims.test.ts`,
		 * which reads the call sites, so a second suite taking a claimed index fails
		 * there rather than as a stranger's transaction going missing.
		 */
		stallingAccountIndex?: number;
	},
): Promise<void> {
	const account = STALLING_WALLET_ACCOUNTS[options.stallingAccountIndex ?? 0];
	if (!account) {
		throw new Error(
			`no stalling-wallet account ${options.stallingAccountIndex}: ` +
				`${STALLING_WALLET_ACCOUNTS.length} are configured`,
		);
	}
	await page.addInitScript(
		({nodeUrl, account, name}) => {
			const held: {resolve?: () => Promise<void>} = {};
			(window as any).__stallingWallet = {
				/** Whether a transaction request is parked right now. */
				isHolding: () => !!held.resolve,
				/** Let the parked transaction through to the node. */
				approve: async () => {
					if (!held.resolve) throw new Error('no transaction is being held');
					await held.resolve();
				},
				/** Hashes this wallet has actually broadcast. */
				sent: [] as string[],
			};

			let id = 0;
			async function rpc(method: string, params: unknown[]) {
				const res = await fetch(nodeUrl, {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({
						id: ++id,
						jsonrpc: '2.0',
						method,
						params: params ?? [],
					}),
				});
				const json = await res.json();
				if (json.error) {
					throw Object.assign(new Error(json.error.message), {
						code: json.error.code,
					});
				}
				return json.result;
			}

			const provider = {
				on() {},
				removeListener() {},
				async request({method, params}: {method: string; params?: unknown[]}) {
					if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
						return [account];
					}
					if (method === 'wallet_switchEthereumChain') return null;
					if (
						method === 'personal_sign' ||
						method === 'eth_sign' ||
						method === 'eth_signTypedData_v4'
					) {
						// Never reached by a wallet-only target step, and a fake signature
						// is safer than a real one: nothing here should be able to
						// authenticate as this account anywhere else.
						return '0x' + '11'.repeat(65);
					}
					if (method === 'eth_sendTransaction') {
						return new Promise((resolve, reject) => {
							held.resolve = async () => {
								held.resolve = undefined;
								try {
									const hash = await rpc('eth_sendTransaction', params ?? []);
									(window as any).__stallingWallet.sent.push(hash);
									resolve(hash);
								} catch (err) {
									reject(err);
								}
							};
						});
					}
					return rpc(method, params ?? []);
				},
			};

			const detail = Object.freeze({
				info: {
					uuid: 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b',
					name,
					icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
					rdns: 'test.jollyroger.stalling',
				},
				provider,
			});
			const announce = () =>
				window.dispatchEvent(
					new CustomEvent('eip6963:announceProvider', {detail}),
				);
			window.addEventListener('eip6963:requestProvider', announce);
			announce();
		},
		{
			nodeUrl: options.nodeUrl,
			account,
			name: STALLING_WALLET_NAME,
		},
	);
}

/** Whether the wallet is currently holding a transaction request. */
export function isHoldingTransaction(page: Page): Promise<boolean> {
	return page.evaluate(() => (window as any).__stallingWallet.isHolding());
}

/** The user finally approves in their wallet. The transaction really is sent. */
export async function approveHeldTransaction(page: Page): Promise<void> {
	await page.evaluate(() => (window as any).__stallingWallet.approve());
}

/** Hashes this wallet has broadcast, for asserting a transaction was real. */
export function sentHashes(page: Page): Promise<string[]> {
	return page.evaluate(() => (window as any).__stallingWallet.sent as string[]);
}
