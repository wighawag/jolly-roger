import {describe, it, expect, vi} from 'vitest';
import {get, readable, writable} from 'svelte/store';
import {privateKeyToAccount} from 'viem/accounts';
import {createExecutor} from '../../../../src/lib/core/connection/executor';
import {guardDispatch} from '../../../../src/lib/core/transaction/dispatch-guard';

// Well-known dev private key (hardhat/anvil account 0); fine for tests.
const DEV_KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

const OWNER = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const SIGNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`;

/** Minimal connection-store stand-in; only `subscribe` is read. */
function makeConnection(initial: unknown) {
	const store = writable(initial);
	return {
		store,
		connection: {subscribe: store.subscribe} as never,
	};
}

/**
 * A client that records before dispatching, like the real one.
 *
 * Guarded rather than a bare stub because `createExecutor` warns in DEV about a
 * client that is not (a variant building its own signer client would otherwise
 * lose transactions silently, see the comment there). Using a realistic client
 * here keeps that warning meaningful instead of background noise.
 */
const walletClient = guardDispatch(
	{tag: 'wallet-client'} as never,
	{record: async () => ({})} as never,
);

function makeExecutor(
	initialState: unknown,
	sendFrom: 'account' | 'signer' = 'account',
) {
	const {store, connection} = makeConnection(initialState);
	return {
		executor: createExecutor({connection, walletClient, sendFrom}),
		store,
	};
}

describe('createExecutor state derivation', () => {
	it('is not-connected when there is no account', () => {
		const {executor} = makeExecutor({step: 'Idle', wallets: []});
		expect(get(executor)).toEqual({status: 'not-connected'});
	});

	it('is ready with the account when a wallet is connected', () => {
		const {executor} = makeExecutor({
			step: 'WalletConnected',
			account: {address: OWNER},
			wallet: {accounts: [OWNER]},
			wallets: [],
		});

		const state = get(executor);
		expect(state.status).toBe('ready');
		if (state.status === 'ready') {
			expect(state.address).toBe(OWNER);
			// The address string, i.e. a JSON-RPC account: the wallet signs.
			expect(state.account).toBe(OWNER);
			expect(state.client).toBe(walletClient);
		}
	});

	/**
	 * An account authenticated without a wallet has nothing to sign with. That is
	 * a state to report, not an error to throw: the app can explain it, and does.
	 */
	it('is cannot-send for an account without a wallet (email/social)', () => {
		const {executor} = makeExecutor({
			step: 'SignedIn',
			account: {address: OWNER, signer: {address: SIGNER}},
			wallet: undefined,
			wallets: [],
		});

		expect(get(executor)).toEqual({status: 'cannot-send'});
	});

	/**
	 * A derived signer is not a sender here.
	 *
	 * Signing in gives the connection a local signer, and this executor still
	 * sends from the account that owns it. That is the whole reason there is one
	 * executor rather than a mode: an app that spends from the signer wants a
	 * second executor, which is a different thing rather than a setting on this
	 * one. See the signer variant of this template.
	 */
	it('sends from the account even when a signer exists', () => {
		const {executor} = makeExecutor({
			step: 'SignedIn',
			account: {address: OWNER, signer: {address: SIGNER}},
			wallet: {accounts: [OWNER]},
			wallets: [],
		});

		const state = get(executor);
		expect(state.status).toBe('ready');
		if (state.status === 'ready') {
			expect(state.address).toBe(OWNER);
			expect(state.address).not.toBe(SIGNER);
			expect(state.client).toBe(walletClient);
		}
	});

	it('follows the connection as it changes', () => {
		const {executor, store} = makeExecutor({step: 'Idle', wallets: []});
		expect(get(executor).status).toBe('not-connected');

		store.set({
			step: 'WalletConnected',
			account: {address: OWNER},
			wallet: {accounts: [OWNER]},
			wallets: [],
		});
		expect(get(executor).status).toBe('ready');

		store.set({step: 'Idle', wallets: []});
		expect(get(executor).status).toBe('not-connected');
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
