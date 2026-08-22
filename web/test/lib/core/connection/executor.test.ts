import {describe, it, expect, vi} from 'vitest';
import {get, readable, writable} from 'svelte/store';
import {privateKeyToAccount} from 'viem/accounts';
import {
	createExecutor,
	memoiseSignerClient,
} from '../../../../src/lib/core/connection/executor';
import {guardDispatch} from '../../../../src/lib/core/transaction/dispatch-guard';

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

/**
 * A client that records before dispatching, like the real one.
 *
 * Guarded rather than a bare stub because `createExecutor` warns in DEV about a
 * client that is not (this branch builds its own signer client and would
 * otherwise lose transactions silently, see the comment there). Using a
 * realistic client here keeps that warning meaningful instead of background
 * noise.
 */
const walletClient = guardDispatch(
	{tag: 'wallet-client'} as never,
	{record: async () => ({})} as never,
);
/** The same, for the local signer: this branch guards that client too. */
const trackedSignerClient = guardDispatch(
	{tag: 'signer-client'} as never,
	{record: async () => ({})} as never,
);

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

describe('createExecutor warns about a client that cannot record', () => {
	// The cascade hazard the PRD flags: guardDispatch is applied once, where the
	// tracked client is built, so a variant that builds a SECOND tracked client
	// for a local signer must guard that one too. Unguarded, every transaction
	// from that signer dispatches with no in-flight record, and nothing about it
	// looks wrong: the transactions go through, they just stop being recoverable.
	function connectionAt(state: unknown) {
		return {subscribe: readable(state).subscribe} as never;
	}

	it('says so for an unguarded client', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			createExecutor({
				connection: connectionAt({step: 'Idle'}),
				walletClient: {tag: 'unguarded'} as never,
				sendFrom: 'account',
			});
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0][0])).toContain('guardDispatch');
		} finally {
			warn.mockRestore();
		}
	});

	it('stays quiet for a guarded one', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			createExecutor({
				connection: connectionAt({step: 'Idle'}),
				walletClient,
				sendFrom: 'account',
			});
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	/**
	 * THE CLIENT THE WARNING IS ACTUALLY ABOUT.
	 *
	 * For a long time it inspected `params.walletClient` and nothing else, so the
	 * signer client, the one a variant has to guard itself and the only reason
	 * this warning exists, was the one it could not see. Confirmed by probe on
	 * `with/local-signer`: unguarded factory, executor `ready`, zero warnings.
	 * The hazard was documented, the tripwire was cited in the cascade brief, and
	 * it was not connected to anything.
	 */
	const SIGNED_IN = {
		step: 'SignedIn',
		account: {
			address: '0x00000000000000000000000000000000000000aa',
			signer: {
				privateKey: DEV_KEY,
				address: '0x00000000000000000000000000000000000000bb',
			},
		},
	};

	it('says so for an unguarded SIGNER client, which nothing else can catch', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const executor = createExecutor({
				connection: connectionAt(SIGNED_IN),
				walletClient,
				sendFrom: 'signer',
				// A fresh object per call, exactly like an unmemoised or unguarded
				// factory: the shape the cascade obligation is about.
				buildSignerClient: () => ({
					client: {tag: 'unguarded-signer'} as never,
					account: privateKeyToAccount(DEV_KEY),
				}),
			});

			// The client is only built when the store is read, which is the reason
			// the construction-time check could never see it.
			expect(get(executor).status).toBe('ready');
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0][0])).toContain('"signer"');
			expect(String(warn.mock.calls[0][0])).toContain('guardDispatch');
		} finally {
			warn.mockRestore();
		}
	});

	it('stays quiet for a guarded signer client', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const guardedSigner = guardDispatch(
				{tag: 'signer'} as never,
				{
					record: async () => ({}),
				} as never,
			);
			const executor = createExecutor({
				connection: connectionAt(SIGNED_IN),
				walletClient,
				sendFrom: 'signer',
				buildSignerClient: () => ({
					client: guardedSigner,
					account: privateKeyToAccount(DEV_KEY),
				}),
			});

			expect(get(executor).status).toBe('ready');
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it('complains once per client, not once per connection change', () => {
		// The check sits inside a `derived` callback, so it re-runs on every
		// reconnect, account switch and sign-in step. A warning printed dozens of
		// times is one the reader learns to scroll past, which would cost the
		// tripwire the only thing it has.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const signerClient = {tag: 'unguarded-signer'} as never;
			const connection = writable(SIGNED_IN);
			const executor = createExecutor({
				connection: {subscribe: connection.subscribe} as never,
				walletClient,
				sendFrom: 'signer',
				buildSignerClient: () => ({
					client: signerClient,
					account: privateKeyToAccount(DEV_KEY),
				}),
			});

			const stop = executor.subscribe(() => {});
			connection.set({...SIGNED_IN});
			connection.set({...SIGNED_IN});
			stop();

			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});
});
