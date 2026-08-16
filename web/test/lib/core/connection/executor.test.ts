import {describe, it, expect} from 'vitest';
import {get, writable} from 'svelte/store';
import {privateKeyToAccount} from 'viem/accounts';
import {
	createExecutor,
	memoiseSignerClient,
} from '../../../../src/lib/core/connection/executor';

// Well-known dev private key (hardhat/anvil account 0); fine for tests.
const DEV_KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const DEV_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const OWNER = '0x1111111111111111111111111111111111111111' as `0x${string}`;

/** Minimal connection-store stand-in; only `subscribe` is read. */
function makeConnection(initial: unknown) {
	const store = writable(initial);
	return {
		store,
		connection: {
			subscribe: store.subscribe,
		} as never,
	};
}

const walletClient = {tag: 'wallet-client'} as never;
const trackedSignerClient = {tag: 'signer-client'} as never;

function makeExecutor(
	initialState: unknown,
	sendFrom: 'account' | 'signer' = 'account',
) {
	const {store, connection} = makeConnection(initialState);
	let buildCount = 0;
	const executor = createExecutor({
		connection,
		walletClient,
		sendFrom,
		buildSignerClient: (privateKey) => {
			buildCount++;
			return {
				client: trackedSignerClient,
				account: privateKeyToAccount(privateKey),
			};
		},
	});
	return {executor, store, getBuildCount: () => buildCount};
}

describe('createExecutor state derivation', () => {
	it('is not-connected when there is no account', () => {
		const {executor} = makeExecutor({step: 'Idle', wallets: []}, 'account');
		expect(get(executor)).toEqual({status: 'not-connected'});
	});

	describe('wallet execution mode', () => {
		it('is ready with the wallet account when a wallet is connected', () => {
			const {executor} = makeExecutor(
				{
					step: 'WalletConnected',
					account: {address: OWNER},
					wallet: {accounts: [OWNER]},
					wallets: [],
				},
				'account',
			);
			const state = get(executor);
			expect(state.status).toBe('ready');
			if (state.status === 'ready') {
				expect(state.address).toBe(OWNER);
				// wallet mode: account is the address string (JSON-RPC account)
				expect(state.account).toBe(OWNER);
				expect(state.client).toBe(walletClient);
			}
		});

		it('is cannot-send for an account without a wallet (email/social)', () => {
			const {executor} = makeExecutor(
				{
					step: 'SignedIn',
					account: {
						address: OWNER,
						signer: {address: DEV_ADDRESS, privateKey: DEV_KEY},
					},
					wallet: undefined,
					wallets: [],
				},
				'account',
			);
			expect(get(executor)).toEqual({status: 'cannot-send'});
		});
	});

	describe('signer execution mode', () => {
		it('is ready with the local signer when SignedIn (even via wallet)', () => {
			const {executor} = makeExecutor(
				{
					step: 'SignedIn',
					account: {
						address: OWNER,
						signer: {address: DEV_ADDRESS, privateKey: DEV_KEY},
					},
					wallet: {accounts: [OWNER]},
					wallets: [],
				},
				'signer',
			);
			const state = get(executor);
			expect(state.status).toBe('ready');
			if (state.status === 'ready') {
				expect(state.address).toBe(DEV_ADDRESS);
				// signer mode: account is a viem Local Account object, not a string
				expect(typeof state.account).toBe('object');
				expect((state.account as {address: string}).address).toBe(DEV_ADDRESS);
				expect((state.account as {type: string}).type).toBe('local');
				expect(state.client).toBe(trackedSignerClient);
			}
		});

		it('is not-connected before the sign-in signature exists', () => {
			const {executor} = makeExecutor(
				{
					step: 'WalletConnected',
					account: {address: OWNER},
					wallet: {accounts: [OWNER]},
					wallets: [],
				},
				'signer',
			);
			expect(get(executor)).toEqual({status: 'not-connected'});
		});

		it('returns whatever the factory gives, without caching it itself', () => {
			// Memoisation deliberately lives with the CALLER (see lib/context), not
			// here. Two executors are built over one signer, and each caching
			// separately would hand out two different client objects for the same
			// key. Transaction tracking identifies clients by reference, so the
			// second object would be one nobody is listening to, and its
			// transactions would silently never appear in the user's list. Keeping
			// the cache in one place upstream is what makes that impossible.
			const signedIn = {
				step: 'SignedIn',
				account: {
					address: OWNER,
					signer: {address: DEV_ADDRESS, privateKey: DEV_KEY},
				},
				wallet: undefined,
				wallets: [],
			};
			const {executor, store, getBuildCount} = makeExecutor(signedIn, 'signer');
			const first = get(executor);
			store.set({...signedIn});
			const second = get(executor);
			if (first.status !== 'ready' || second.status !== 'ready') {
				throw new Error('expected ready states');
			}
			// The factory is asked every time rather than once. This fake happens to
			// return a shared client constant but a fresh account object, so the
			// account is what shows the absence of an internal cache.
			expect(getBuildCount()).toBe(2);
			expect(first.account).not.toBe(second.account);
		});

		it('hands out one client when the factory memoises', () => {
			// The arrangement lib/context actually uses.
			const signedIn = {
				step: 'SignedIn',
				account: {
					address: OWNER,
					signer: {address: DEV_ADDRESS, privateKey: DEV_KEY},
				},
				wallet: undefined,
				wallets: [],
			};
			const {connection} = makeConnection(signedIn);
			let built = 0;
			let cached: {client: unknown; account: unknown} | undefined;
			const buildSignerClient = ((privateKey: `0x${string}`) => {
				if (!cached) {
					built++;
					cached = {
						client: {id: 'signer-client', privateKey},
						account: {address: DEV_ADDRESS},
					};
				}
				return cached;
			}) as never;

			const one = createExecutor({
				connection,
				walletClient,
				sendFrom: 'signer',
				buildSignerClient,
			});
			const two = createExecutor({
				connection,
				walletClient,
				sendFrom: 'signer',
				buildSignerClient,
			});

			const a = get(one);
			const b = get(two);
			if (a.status !== 'ready' || b.status !== 'ready') {
				throw new Error('expected ready states');
			}
			// Two executors, ONE client. This is the property tracking depends on.
			expect(a.client).toBe(b.client);
			expect(built).toBe(1);
		});
	});
});

describe('memoiseSignerClient', () => {
	const KEY_A = '0xaa' as `0x${string}`;
	const KEY_B = '0xbb' as `0x${string}`;
	const built = (privateKey: `0x${string}`) =>
		({client: {privateKey}, account: {privateKey}}) as never;

	it('returns the SAME object for the same key', () => {
		// The property everything else depends on. Transaction tracking attaches
		// per client and compares by reference, so a second object for one key is
		// a client nobody listens to: its transactions still go through, they just
		// stop appearing in the user's list. Nothing throws, which is why this
		// needs a test rather than a comment.
		let calls = 0;
		const build = memoiseSignerClient((k) => {
			calls++;
			return built(k);
		});
		expect(build(KEY_A)).toBe(build(KEY_A));
		expect(calls).toBe(1);
	});

	it('rebuilds when the key changes, and forgets the old one', () => {
		// Re-signing in as a different identity derives a different key. The old
		// client must fall out of use rather than linger.
		let calls = 0;
		const build = memoiseSignerClient((k) => {
			calls++;
			return built(k);
		});
		const a = build(KEY_A);
		const b = build(KEY_B);
		expect(b).not.toBe(a);
		expect(calls).toBe(2);
		// Back to A: a fresh build, not the first object resurrected from a map
		// keyed by a stale secret.
		expect(build(KEY_A)).not.toBe(a);
		expect(calls).toBe(3);
	});

	it('gives two executors one client for one signer', () => {
		// The arrangement lib/context uses, asserted end to end through the
		// executors rather than only through the helper.
		const signedIn = {
			step: 'SignedIn',
			account: {
				address: OWNER,
				signer: {address: DEV_ADDRESS, privateKey: DEV_KEY},
			},
			wallet: undefined,
			wallets: [],
		};
		const {connection} = makeConnection(signedIn);
		const buildSignerClient = memoiseSignerClient((privateKey) => ({
			client: {tag: 'signer-client'} as never,
			account: privateKeyToAccount(privateKey),
		}));
		const one = createExecutor({
			connection,
			walletClient,
			sendFrom: 'signer',
			buildSignerClient,
		});
		const two = createExecutor({
			connection,
			walletClient,
			sendFrom: 'signer',
			buildSignerClient,
		});
		const a = get(one);
		const b = get(two);
		if (a.status !== 'ready' || b.status !== 'ready') {
			throw new Error('expected ready states');
		}
		expect(a.client).toBe(b.client);
		expect(a.account).toBe(b.account);
	});
});

describe('createExecutor guards its construction', () => {
	// The failure this prevents is quiet: an executor with no way to build its
	// signer client would sit at `not-connected` looking like "not signed in
	// yet", and only die when the user finally tried to send.
	it('refuses sendFrom "signer" without a client factory', () => {
		const {connection} = makeConnection({step: 'Idle', wallets: []});
		expect(() =>
			createExecutor({connection, walletClient, sendFrom: 'signer'}),
		).toThrow(/buildSignerClient/);
	});

	it('does not require one to send from the account', () => {
		const {connection} = makeConnection({step: 'Idle', wallets: []});
		expect(() =>
			createExecutor({connection, walletClient, sendFrom: 'account'}),
		).not.toThrow();
	});
});
