import {describe, it, expect, vi} from 'vitest';
import {get, readable, writable} from 'svelte/store';
import {createExecutor} from '../../../../src/lib/core/connection/executor';
import {guardDispatch} from '../../../../src/lib/core/transaction/dispatch-guard';

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
});
