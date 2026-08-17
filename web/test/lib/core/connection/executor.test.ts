import {describe, it, expect} from 'vitest';
import {get, writable} from 'svelte/store';
import {createExecutor} from '../../../../src/lib/core/connection/executor';

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

const walletClient = {tag: 'wallet-client'} as never;

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
