import {describe, it, expect, vi} from 'vitest';
import {writable} from 'svelte/store';
import {
	ensureCanSignAs,
	type SignableConnection,
} from '../../../../src/lib/core/connection/ensure-can-sign';

const PAYER = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`;

const wallet = (name: string, rdns?: string) => ({info: {name, rdns}});

function makeConnection(params: {
	wallets?: {info: {name: string; rdns?: string}}[];
	account?: `0x${string}`;
	wallet?: {status: string};
}) {
	const store = writable<unknown>({
		wallets: params.wallets ?? [],
		account: params.account ? {address: params.account} : undefined,
		wallet: params.wallet,
	});
	const ensureConnected = vi.fn(async () => ({}));
	return {
		ensureConnected,
		connection: {
			subscribe: store.subscribe,
			ensureConnected,
		} as unknown as SignableConnection,
	};
}

describe('ensureCanSignAs', () => {
	it('ASKS EVERY TIME, with no "are we already there" check in front of it', async () => {
		// There was such a check, and it was a bug. It compared
		// `connection.account.address`, which is the address the connection AGREED
		// on, not the one the wallet can sign with now: the library leaves
		// `account` untouched when the wallet locks. So it passed for a LOCKED
		// wallet, skipped the one call that would have prompted an unlock, let the
		// send go out, and got back code 4001, which this app reported as
		// "Transaction rejected by user" about a prompt nobody was shown.
		//
		// `ensureConnected` resolves immediately when there is nothing to do and
		// knows how to reconnect a locked wallet when there is, so asking always
		// is both cheaper and more correct than restating that judgement here.
		const {ensureConnected, connection} = makeConnection({
			account: PAYER,
			wallet: {status: 'locked'},
		});

		await ensureCanSignAs(connection, {address: PAYER}, {remember: true});

		expect(ensureConnected).toHaveBeenCalledOnce();
	});

	it('asks for the recorded wallet AND the address together', async () => {
		// The pair is the whole point: the address alone lands on whatever wallet
		// happens to be connected, and the wallet alone on whatever account it
		// happens to have selected.
		const {ensureConnected, connection} = makeConnection({
			wallets: [wallet('Rabby', 'io.rabby')],
		});

		await ensureCanSignAs(
			connection,
			{address: PAYER, wallet: {name: 'Rabby', rdns: 'io.rabby'}},
			{remember: false},
		);

		expect(ensureConnected).toHaveBeenCalledWith(
			'WalletConnected',
			{type: 'wallet', name: 'Rabby', address: PAYER},
			{doNotStoreLocally: true},
		);
	});

	it('does not persist a payer, whose wallet is chosen per payment', async () => {
		// Reopening the wallet that sent ONE transaction is not a statement about
		// who pays next time. The payment rail clears that slot before every
		// payment on purpose; re-persisting it here would reintroduce the
		// sticky-payer bug that clearing exists to prevent.
		const {ensureConnected, connection} = makeConnection({});

		await ensureCanSignAs(connection, {address: PAYER}, {remember: false});

		expect(ensureConnected).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			{doNotStoreLocally: true},
		);
	});

	it('DOES persist the app account, whose wallet is the user identity', async () => {
		// The other half, and the one that was wrong: the app connection
		// auto-connects to the wallet it saw last. Recovering a stuck transaction
		// with doNotStoreLocally would silently cost the user that memory, so they
		// would be asked to pick their own wallet again on the next page load.
		const {ensureConnected, connection} = makeConnection({});

		await ensureCanSignAs(connection, {address: PAYER}, {remember: true});

		expect(ensureConnected).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			{doNotStoreLocally: false},
		);
	});

	it('uses the live name when the wallet has renamed itself', async () => {
		const {ensureConnected, connection} = makeConnection({
			wallets: [wallet('Rabby Wallet', 'io.rabby')],
		});

		await ensureCanSignAs(
			connection,
			{address: PAYER, wallet: {name: 'Rabby', rdns: 'io.rabby'}},
			{remember: false},
		);

		expect(ensureConnected).toHaveBeenCalledWith(
			'WalletConnected',
			expect.objectContaining({name: 'Rabby Wallet'}),
			expect.anything(),
		);
	});

	it('asks by address alone for a record with no wallet, so the picker opens', async () => {
		// An operation stored before sources existed. Asking the user beats
		// telling them nothing can be done.
		const {ensureConnected, connection} = makeConnection({});

		await ensureCanSignAs(connection, {address: PAYER}, {remember: true});

		expect(ensureConnected).toHaveBeenCalledWith(
			'WalletConnected',
			{type: 'wallet', address: PAYER},
			expect.anything(),
		);
	});

	it('lets a refusal through, rather than inventing a second dialect for it', async () => {
		// The caller already tells a refusal from a real failure, because every
		// other send in this app has to. Translating here would give the app two
		// places to disagree about what a cancelled connection means.
		const store = writable<unknown>({wallets: [], account: undefined});
		const connection = {
			subscribe: store.subscribe,
			ensureConnected: async () => {
				throw new Error('Connection cancelled');
			},
		} as unknown as SignableConnection;

		await expect(
			ensureCanSignAs(connection, {address: PAYER}, {remember: true}),
		).rejects.toThrow('Connection cancelled');
	});
});
