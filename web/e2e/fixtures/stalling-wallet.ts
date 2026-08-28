import {expect, type Page} from '@playwright/test';

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

/**
 * What the transaction {@link sendAndStall} dispatches is CALLED, in the words
 * the app puts on screen for it.
 *
 * Exported next to the walk that sends it, because it is the same fact: change
 * which write the walk drives and this changes with it. A suite that asserts the
 * app named what it is sending (the sending notice does) reads it from here
 * rather than repeating a literal - `setMessage` is the template's
 * GreetingsRegistry, and a descendant that does not deploy it inherited an
 * assertion for a function it never calls.
 */
export const STALLED_SEND_NAME = 'setMessage';

/**
 * Get this app to hand the stalling wallet a transaction, and leave it holding
 * it. Call {@link installStallingWallet} first: the wallet has to be announced
 * before the app starts looking.
 *
 * ONE PLACE, BECAUSE THE ROUTE TO THAT WINDOW IS AN APP'S OWN BUSINESS. Two
 * suites need a wallet that is holding something (the escape hatch and the
 * sending indicator), and both used to open-code the same walk: pick the page,
 * fill it, submit, choose the wallet, wait. That is the shape `e2e/routes.ts`
 * exists to prevent, and it rotted the same way: a descendant that sends through
 * a LOCAL SIGNER has no wallet in the demo page's Send at all, so the walk has
 * to change, and when only one of the two copies was adapted the other spent
 * thirty seconds waiting for a wallet that was never going to be asked. It did
 * not look like a stale test either; it looked like the indicator was broken.
 *
 * So a descendant overrides THIS function and inherits both suites. What it must
 * end up in is the only part that is fixed: a wallet holding a request, with
 * nothing else on screen waiting on the test.
 *
 * The two tolerances below are here for the same reason, and both are inert in
 * this app:
 *
 * - the wallet LIST may be collapsed behind one button when the app also offers
 *   email or social sign-in, so the picker is two clicks rather than one
 *   (`walletEntryMode`).
 * - the flow may stop at "Confirm sign in" before it asks the wallet for
 *   anything, in an app that signs in rather than merely connecting. Skipping
 *   that click leaves the connection parked there forever, no request ever
 *   reaches the wallet, and the failure surfaces as a timeout three assertions
 *   later.
 *
 * Both are written as "click it if it is there" rather than as a branch on which
 * app this is, so this file stays the same in a descendant that only adds one of
 * them. NEITHER MAY COST TIME IT DOES NOT NEED: a caller measures from the
 * moment this returns, so a fixed "wait 2s in case a sign-in modal appears"
 * spends the delay the sending notice is being timed against, and the suite
 * fails claiming the app was too fast. See {@link waitUntilHolding}.
 */
export async function sendAndStall(
	page: Page,
	options?: {
		/**
		 * A distinctive value to send, for a caller that will later assert THEIR
		 * input survived. Optional, and that is the interface working rather than
		 * a convenience.
		 *
		 * WHAT IT IS HAS TO BE THE APP'S BUSINESS, not the caller's. This app fills
		 * `setMessage`'s string argument, so any value does; a descendant's write takes an ADDRESS,
		 * and a suite that hardcoded 'sending indicator' there filled an invalid
		 * field, so the form never submitted and nothing ever reached the wallet -
		 * the same failure this whole helper exists to stop, one layer in. A suite
		 * that does not care omits it and gets whatever this app can send; a suite
		 * that does care is a suite already adapted per app, and passes something
		 * valid here.
		 */
		input?: string;
	},
): Promise<void> {
	// THROUGH /contracts ON THIS BRANCH, NOT THE DEMO PAGE, and this is the
	// override the template's version was written to receive.
	//
	// This app posts through a LOCAL SIGNER: the demo page's Send is signed with a
	// key the app already holds, so it never reaches the user's wallet and a
	// stalling wallet cannot stand in that window, because for that page the
	// window does not exist. The ACCOUNT executor still goes to the wallet, and
	// `/contracts` calls it directly, which makes it the shortest route to a
	// wallet that has a transaction and is not answering.
	//
	// Stated HERE rather than in a suite, because two suites need it and stating
	// it in one of them is precisely how the other spent thirty seconds waiting
	// for a wallet that was never going to be asked.
	await page.goto('/contracts');

	const writeTab = page.getByRole('tab', {name: 'Write'});
	await expect(writeTab).toBeVisible({timeout: 30_000});
	await writeTab.click();

	await expect(page.getByText('setMessage nonpayable')).toBeVisible({
		timeout: 30_000,
	});
	await writeForm(page)
		.getByPlaceholder('Enter text...')
		.first()
		.fill(options?.input ?? 'a request nobody answers');
	await executeButton(page).click();

	await chooseStallingWallet(page);

	// The wallet now has the transaction and is not answering, which is the state
	// a user gets stuck in. `waitUntilHolding` also clicks through "Confirm sign
	// in", which THIS app always shows: the flow parks at WalletConnected until
	// the user says yes, and skipping it leaves the connection there forever with
	// no request ever reaching the wallet.
	await waitUntilHolding(page);
}

/**
 * The write form `sendAndStall` drives, and its submit control.
 *
 * Exported because a suite asserts on the very control this clicked (that it
 * says "Executing..." and stops saying it), and two definitions of the same
 * locator is one definition too many.
 *
 * The submit control is matched on the STEM, so it is the same locator whether
 * it reads "Execute" or "Executing...". `/execute/i` matches only the first of
 * those, since "executing" does not contain "execute", and a test then reads as
 * though the button had vanished at exactly the moment it was busy.
 */
export const writeForm = (page: Page) =>
	page
		.locator('[class*="card"], [class*="function"]')
		.filter({has: page.getByText('setMessage nonpayable')})
		.first();

export const executeButton = (page: Page) =>
	writeForm(page).locator('button', {hasText: /execut/i});

/**
 * Pick this wallet out of however the app is offering wallets today.
 *
 * With several wallets and nothing else to sign in with, the list is shown
 * directly; sharing the modal with email or social collapses it behind one
 * button instead of drowning them. Waiting for EITHER and clicking through when
 * the button is there keeps one helper correct for both.
 */
export async function chooseStallingWallet(page: Page): Promise<void> {
	const walletEntry = page.getByRole('button', {name: /^connect a wallet$/i});
	const stallingWallet = page.getByRole('button', {
		name: new RegExp(STALLING_WALLET_NAME, 'i'),
	});

	await expect(walletEntry.or(stallingWallet).first()).toBeVisible({
		timeout: 30_000,
	});
	if (await walletEntry.isVisible().catch(() => false)) {
		await walletEntry.click();
	}
	await stallingWallet.click({timeout: 30_000});
}

/**
 * Wait until the wallet is holding the request, confirming sign-in on the way if
 * this app asks for it.
 *
 * RACED, NOT SEQUENCED, and that is the whole design of it. "Click Sign In if it
 * shows up within 2s, then wait for the wallet" is the obvious version and it is
 * wrong twice: it burns two seconds in an app that never asks, and two seconds
 * is not obviously enough in one that does, under load. Watching for both
 * outcomes at once costs nothing when the wallet is asked directly, and waits as
 * long as it takes when a modal is in the way.
 *
 * An app that signs in parks at "Confirm sign in" until the user says yes, and
 * the stalling wallet answers the sign-in signature with a fixed fake one
 * (nothing verifies it locally: it is entropy for deriving a signer, and a real
 * key here would let this fixture authenticate as that account elsewhere).
 */
async function waitUntilHolding(page: Page, timeout = 60_000): Promise<void> {
	const signIn = page.getByRole('button', {name: /^sign in$/i});
	const deadline = Date.now() + timeout;

	while (Date.now() < deadline) {
		// Asked FIRST on every pass, so the loop returns the instant the wallet has
		// it and a caller's clock starts as close to the dispatch as it can.
		if (await isHoldingTransaction(page).catch(() => false)) return;
		if (await signIn.isVisible().catch(() => false)) {
			// May lose a race with the app moving on; that is fine, the next pass
			// looks again.
			await signIn.click().catch(() => {});
		}
		await page.waitForTimeout(100);
	}

	throw new Error(
		`the stalling wallet was never handed a transaction within ${timeout}ms. ` +
			`Either the flow is parked on a step this helper does not know how to ` +
			`answer, or this app does not send through the user's wallet here at ` +
			`all - a descendant that signs with a key of its own has to point ` +
			`sendAndStall at a page that does.`,
	);
}
