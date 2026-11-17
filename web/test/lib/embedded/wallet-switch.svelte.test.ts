import {describe, it, expect, afterEach} from 'vitest';
import {get, type Readable} from 'svelte/store';
import {mnemonicToAccount} from 'viem/accounts';
import {startEmbeddedNode} from '$lib/embedded/node';
import {createEmbeddedDeployments} from '$lib/embedded/deployments';
import {embeddedConnectionFactory} from '$lib/embedded/world';
import {
	announceEmbeddedWallet,
	type EmbeddedWallet,
} from '$lib/embedded/wallet';
import type {EIP1193ProviderLike} from '$lib/embedded/types';

// `.svelte.` infix: the `client` project, a real headless chromium, because the
// burner keeps its mnemonic in localStorage and the connection persists its
// account there too.
//
// WHAT IT PINS: a world with several people at one device (hotseat) switches
// the active account with ONE connection. The wallet selects an account and
// announces it; the world's connection, built with `useCurrentAccount:
// 'always'`, follows it by reconnecting as that account, with no account
// picker and no prompt; and a signature then derives THAT account's browser
// key, the same one every time it comes back. If any of that stops holding, a
// hotseat world would play every human with the first one's key, or hang at a
// picker nobody can see.

const CHAIN_ID = 9007199254740417;

type ConnectionView = {
	step: string;
	mechanism?: {address?: string};
	account?: {address?: string; signer?: {address: string}};
};

let dispose: (() => Promise<void>) | undefined;
let wallet: EmbeddedWallet | undefined;
let previousWallet: EmbeddedWallet | undefined;
let stop: (() => void) | undefined;
afterEach(async () => {
	stop?.();
	stop = undefined;
	wallet?.cleanup();
	wallet = undefined;
	previousWallet?.cleanup();
	previousWallet = undefined;
	await dispose?.();
	dispose = undefined;
	localStorage.clear();
});

function until<T>(
	store: Readable<T>,
	predicate: (value: T) => boolean,
	what: string,
	timeoutMs = 10_000,
): Promise<T> {
	return new Promise((resolve, reject) => {
		let unsubscribe: (() => void) | undefined;
		let done = false;
		const timer = setTimeout(() => {
			done = true;
			unsubscribe?.();
			reject(
				new Error(
					`timed out waiting for ${what}: ${JSON.stringify(get(store))}`,
				),
			);
		}, timeoutMs);
		unsubscribe = store.subscribe((value) => {
			if (done || !predicate(value)) return;
			done = true;
			clearTimeout(timer);
			queueMicrotask(() => unsubscribe?.());
			resolve(value);
		});
	});
}

/**
 * The node a world's wallet talks to, able to HOLD one method's answers: an
 * in-tab chain still booting answers `eth_chainId` late. The node rather than
 * the wallet, because the wallet's own `on`/`removeListener` must reach the
 * connection untouched (see `wallet.ts`), and the node is a bare `request`.
 */
function holdingNode(node: EIP1193ProviderLike) {
	let holding: string | undefined;
	const held: (() => void)[] = [];
	return {
		provider: {
			async request(args: {method: string; params?: unknown}) {
				if (args.method === holding) {
					await new Promise<void>((resume) => held.push(resume));
				}
				return node.request(args);
			},
		} satisfies EIP1193ProviderLike,
		/** Hold every `method` asked from now on, until `release`. */
		hold(method: string) {
			holding = method;
		},
		/** Answer the next ones at once again; the held ones stay held. */
		stopHolding() {
			holding = undefined;
		},
		heldCount: () => held.length,
		release() {
			for (const resume of held.splice(0)) resume();
		},
	};
}

function connectionFactoryFor(
	node: {provider: EIP1193ProviderLike},
	walletHandle: EmbeddedWallet['handle'],
) {
	return embeddedConnectionFactory({
		chainId: CHAIN_ID,
		node,
		deployments: createEmbeddedDeployments({
			chainId: CHAIN_ID,
			chain: {
				name: 'Embedded',
				nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
			},
			name: 'embedded',
			contracts: {},
			expected: [],
		}),
		wallets: [walletHandle],
	});
}

function establish(
	establishConnection: ReturnType<typeof connectionFactoryFor>,
) {
	// Asked as the app asks it: a SignedIn target, built-in wallets only.
	const established = establishConnection({
		targetStep: 'SignedIn',
		walletOnly: true,
	});
	return established.connection as unknown as Readable<ConnectionView> & {
		ensureConnected: (step?: 'WalletConnected') => Promise<unknown>;
		requestSignature: () => Promise<unknown>;
	};
}

async function bootWithAccounts(accounts: number) {
	// A chain with nothing deployed, and the connection built exactly as a
	// world builds its own (`embeddedConnectionFactory`, which
	// `createEmbeddedWorld` calls). No app contracts on purpose: this file
	// arrives unchanged in every descendant, each with contracts of its own,
	// and what it measures is the wallet and the connection.
	const node = await startEmbeddedNode({chainId: CHAIN_ID});
	dispose = node.dispose;
	wallet = await announceEmbeddedWallet({
		provider: node.provider,
		chainId: CHAIN_ID,
		accounts,
	});
	return {connection: establish(connectionFactoryFor(node, wallet.handle))};
}

describe('several accounts in one embedded wallet', () => {
	it('derives them in index order and keeps that order whoever is selected', async () => {
		await bootWithAccounts(3);
		const held = wallet!;
		const mnemonic = localStorage.getItem(
			`embedded-wallet:${CHAIN_ID}:mnemonic`,
		);
		expect(mnemonic).toBeTruthy();
		expect(held.accounts).toHaveLength(3);
		for (const [index, address] of held.accounts.entries()) {
			expect(address.toLowerCase()).toBe(
				mnemonicToAccount(mnemonic!, {
					addressIndex: index,
				}).address.toLowerCase(),
			);
		}
		expect(() =>
			held.select('0x70997970C51812dc3A010C7d01b50e0d17dc79C8'),
		).toThrow(/does not hold/);
	});

	it('one by default, as before', async () => {
		await bootWithAccounts(1);
		expect(wallet!.accounts).toHaveLength(1);
	});

	it('switches the connection, and the browser key, with no picker and no prompt', async () => {
		const {connection} = await bootWithAccounts(2);
		const [first, second] = wallet!.accounts.map((a) => a.toLowerCase());

		await connection.ensureConnected('WalletConnected');
		await connection.requestSignature();
		const signedInFirst = await until(
			connection,
			(c) => c.step === 'SignedIn',
			'the first sign-in',
		);
		expect(signedInFirst.account?.address?.toLowerCase()).toBe(first);
		const firstKey = signedInFirst.account?.signer?.address;
		expect(firstKey).toBeTruthy();

		// The switch: the wallet announces, the connection follows by itself and
		// stops before the signature, as at boot.
		wallet!.select(wallet!.accounts[1]);
		const following = await until(
			connection,
			(c) =>
				c.mechanism?.address?.toLowerCase() === second &&
				(c.step === 'WalletConnected' || c.step === 'SignedIn'),
			'the connection to follow the second account',
		);
		expect(following.step).not.toBe('ChooseWalletAccount');
		await connection.requestSignature();
		const signedInSecond = await until(
			connection,
			(c) =>
				c.step === 'SignedIn' && c.account?.address?.toLowerCase() === second,
			'the second sign-in',
		);
		const secondKey = signedInSecond.account?.signer?.address;
		expect(secondKey).toBeTruthy();
		expect(secondKey).not.toBe(firstKey);

		// And back: the same key as the first time, derived again.
		wallet!.select(wallet!.accounts[0]);
		await until(
			connection,
			(c) =>
				c.mechanism?.address?.toLowerCase() === first &&
				(c.step === 'WalletConnected' || c.step === 'SignedIn'),
			'the connection to follow the first account back',
		);
		await connection.requestSignature();
		const signedInAgain = await until(
			connection,
			(c) =>
				c.step === 'SignedIn' && c.account?.address?.toLowerCase() === first,
			'the first sign-in again',
		);
		expect(signedInAgain.account?.signer?.address).toBe(firstKey);
	});
});

// WHAT IT PINS: a reload in a hotseat world, where the connection restores the
// account it last signed in as (A) while the person now holding the device is
// someone else (B). The restore has to ask the wallet `eth_chainId` and
// `eth_accounts` first, and a chain still booting answers late, so B can be
// selected and signed in before it lands. Up to @etherplay/connect 0.17.0 the
// restore then published A over B, and `useCurrentAccount` followed the wallet
// back to B WITHOUT a signature: the world was left with no signer.
// template-commit-reveal's hotseat met it after a reload mid commit phase
// (its finding `a-stored-account-auto-connect-lands-after-a-later-switch`).
// Fixed in 0.17.1: a restore that something overtook publishes nothing.
describe('a reload whose restore lands late', () => {
	it('keeps the account signed in since, with its signer, when the stored one is restored too late', async () => {
		const node = await startEmbeddedNode({chainId: CHAIN_ID});
		dispose = node.dispose;
		const slow = holdingNode(node.provider);

		// The previous visit: signed in as A, which the connection stores.
		previousWallet = await announceEmbeddedWallet({
			provider: slow.provider,
			chainId: CHAIN_ID,
			accounts: 2,
		});
		const [first, second] = previousWallet.accounts.map((a) => a.toLowerCase());
		const before = establish(connectionFactoryFor(slow, previousWallet.handle));
		await before.ensureConnected('WalletConnected');
		await before.requestSignature();
		await until(
			before,
			(c) =>
				c.step === 'SignedIn' && c.account?.address?.toLowerCase() === first,
			'the previous visit signed in as the first account',
		);
		expect(
			localStorage.getItem(`embedded:${CHAIN_ID}:__origin_account`),
		).toContain(previousWallet.accounts[0].slice(2).toLowerCase());
		previousWallet.cleanup();

		// The reload: the same mnemonic, a chain slow to say which it is, and a
		// connection whose restore of A waits on that answer.
		wallet = await announceEmbeddedWallet({
			provider: slow.provider,
			chainId: CHAIN_ID,
			accounts: 2,
		});
		slow.hold('eth_chainId');
		const connection = establish(connectionFactoryFor(slow, wallet.handle));
		const seen: ConnectionView[] = [];
		stop = connection.subscribe((c) => seen.push(c));
		await expect
			.poll(() => slow.heldCount(), {timeout: 5_000})
			.toBeGreaterThan(0);
		slow.stopHolding();

		// Meanwhile it is B's turn: selected and signed in.
		wallet.select(wallet.accounts[1]);
		await connection.ensureConnected('WalletConnected');
		await connection.requestSignature();
		const signedInAsB = await until(
			connection,
			(c) =>
				c.step === 'SignedIn' && c.account?.address?.toLowerCase() === second,
			'the second account signed in while the restore waits',
		);
		const keyOfB = signedInAsB.account?.signer?.address;
		expect(keyOfB).toBeTruthy();
		const signedInAt = seen.length;

		// The chain answers at last, and the restore of A gets its turn.
		slow.release();
		await new Promise((settle) => setTimeout(settle, 500));

		const after = get(connection);
		expect(after.step).toBe('SignedIn');
		expect(after.account?.address?.toLowerCase()).toBe(second);
		expect(after.account?.signer?.address).toBe(keyOfB);
		// And never A in between: nobody saw the previous visit come back.
		expect(
			seen
				.slice(signedInAt)
				.filter((c) => c.account?.address?.toLowerCase() === first),
		).toEqual([]);
	});
});

// WHAT IT PINS: a reload where an ACTION runs before the stored session is back.
// Every app action calls `ensureConnected()` (a game's commit, a table's
// creation), and a person can click while the page is still loading, so the
// call starts while the restore of the account they signed in as is still
// waiting on the wallet (a chain still booting answers `eth_chainId` late).
// From @etherplay/connect 0.17.1 to 0.17.2 such a call overtook the restore and
// started a sign-in of its own: the account picker, a signature asked again,
// for the account that was signed in all along (template-commit-reveal's
// `table.e2e.ts` met it: reload, create a table at once). Fixed in 0.17.3: a
// call that names nothing new JOINS the restore, waits for it, and carries on
// signed in. A call that names another account still wins, as the case above
// pins.
describe('a reload that acts at once', () => {
	it('stays signed in as the stored account, with its signer, and asks for no signature', async () => {
		const node = await startEmbeddedNode({chainId: CHAIN_ID});
		dispose = node.dispose;
		const slow = holdingNode(node.provider);

		// The previous visit: signed in as A, which the connection stores.
		previousWallet = await announceEmbeddedWallet({
			provider: slow.provider,
			chainId: CHAIN_ID,
			accounts: 2,
		});
		const first = previousWallet.accounts[0].toLowerCase();
		const before = establish(connectionFactoryFor(slow, previousWallet.handle));
		await before.ensureConnected('WalletConnected');
		await before.requestSignature();
		const signedInBefore = await until(
			before,
			(c) =>
				c.step === 'SignedIn' && c.account?.address?.toLowerCase() === first,
			'the previous visit signed in as the first account',
		);
		const keyOfA = signedInBefore.account?.signer?.address;
		expect(keyOfA).toBeTruthy();
		previousWallet.cleanup();

		// The reload: the restore of A waits on the chain's answer.
		wallet = await announceEmbeddedWallet({
			provider: slow.provider,
			chainId: CHAIN_ID,
			accounts: 2,
		});
		slow.hold('eth_chainId');
		const connection = establish(connectionFactoryFor(slow, wallet.handle));
		const seen: ConnectionView[] = [];
		stop = connection.subscribe((c) => seen.push(c));
		await expect
			.poll(() => slow.heldCount(), {timeout: 5_000})
			.toBeGreaterThan(0);
		slow.stopHolding();

		// An action, before the restore lands: what every app action calls.
		const acted = connection.ensureConnected().then(
			() => 'resolved' as const,
			(error: unknown) => error,
		);

		// The chain answers, and the restore lands.
		slow.release();
		const outcome = await Promise.race([
			acted,
			new Promise((settle) => setTimeout(() => settle('still waiting'), 5_000)),
		]);
		expect(outcome).toBe('resolved');

		const after = get(connection);
		expect(after.step).toBe('SignedIn');
		expect(after.account?.address?.toLowerCase()).toBe(first);
		expect(after.account?.signer?.address).toBe(keyOfA);
		// And no sign-in of its own on the way: no picker, no signature asked.
		expect(
			seen
				.map((c) => c.step)
				.filter((step) =>
					[
						'MechanismToChoose',
						'WalletToChoose',
						'ChooseWalletAccount',
						'WaitingForSignature',
					].includes(step),
				),
		).toEqual([]);
	});
});
