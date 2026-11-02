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
let stop: (() => void) | undefined;
afterEach(async () => {
	stop?.();
	stop = undefined;
	wallet?.cleanup();
	wallet = undefined;
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
	const establishConnection = embeddedConnectionFactory({
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
		wallets: [wallet.handle],
	});
	// Asked as the app asks it: a SignedIn target, built-in wallets only.
	const established = establishConnection({
		targetStep: 'SignedIn',
		walletOnly: true,
	});
	return {
		connection:
			established.connection as unknown as Readable<ConnectionView> & {
				ensureConnected: (step: 'WalletConnected') => Promise<unknown>;
				requestSignature: () => Promise<unknown>;
			},
	};
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
