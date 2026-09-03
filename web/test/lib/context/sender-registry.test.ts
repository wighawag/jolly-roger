import {describe, it, expect, vi} from 'vitest';
import {get, writable} from 'svelte/store';
import {createSenderRegistry} from '$lib/context/sender-registry';
import {selectSender} from '$lib/core/connection/senders';
import type {ExecutorState} from '$lib/core/connection/executor';

/**
 * THE COMPOSITION THIS BRANCH ADDS, and the one `main` cannot test.
 *
 * `main` has a single route, so its own tests exercise `selectSender` against
 * registries they build by hand. That leaves the interesting half untested
 * HERE, where three real routes are wired to two different connections: the
 * question is no longer "does selection work" but "did this app register what
 * it can actually send from, and does each route reconnect the right way".
 *
 * Both failures this pins are silent. A missing route is a stuck transaction
 * that can never be replaced, discovered months later by a user; a route
 * reconnecting the wrong way either loses the user their remembered wallet or
 * makes a payer sticky, and neither raises anything.
 */

const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;
const SIGNER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`;
const PAYER = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`;

const ready = (address: `0x${string}`): ExecutorState => ({
	status: 'ready',
	address,
	account: address,
	client: {} as never,
});

/**
 * The two connections, as much of them as the registry touches.
 *
 * `ensureConnected` records HOW it was called, because that is the whole of
 * what distinguishes the three routes: the wallet routes name a step, a wallet
 * and an address, and the signer route names nothing at all.
 */
function harness(options?: {payer?: `0x${string}`}) {
	const connection = Object.assign(writable<unknown>({step: 'SignedIn'}), {
		ensureConnected: vi.fn(async () => ({step: 'SignedIn'})),
	});
	const paymentConnection = Object.assign(
		writable<unknown>(
			options?.payer
				? {step: 'WalletConnected', account: {address: options.payer}}
				: {step: 'Idle'},
		),
		{ensureConnected: vi.fn(async () => ({step: 'WalletConnected'}))},
	);

	const senders = createSenderRegistry({
		connection: connection as never,
		payment: {
			connection: paymentConnection,
			walletClient: {} as never,
			publicClient: {} as never,
		} as never,
		accountExecutor: writable(ready(ACCOUNT)),
		signerExecutor: writable(ready(SIGNER)),
		accountBalance: {} as never,
		signerBalance: {} as never,
		payerBalance: {} as never,
	});

	return {senders, connection, paymentConnection};
}

describe('the routes this app registers', () => {
	it('registers all three, because an unregistered route cannot be replaced', () => {
		// The list, not the count: a route silently dropped is a class of
		// transaction that can never be unstuck, and nothing else in the app
		// notices.
		const {senders} = harness();
		expect(senders.map((sender) => sender.route)).toEqual([
			'account',
			'signer',
			'rail',
		]);
	});
});

describe('a transaction paid for on the rail', () => {
	/**
	 * THE BUG, in this app's own wiring.
	 *
	 * An avatar was bought through the payment rail, the rail went dormant as it
	 * always does, and Resubmit reported the user's own payment as belonging to a
	 * different account. The account executor was ready the whole time, which is
	 * exactly why searching for a ready executor could not be the answer.
	 */
	it('routes to the rail even though the account executor is ready', () => {
		const {senders} = harness();
		const selection = selectSender(senders, {
			from: PAYER,
			source: {route: 'rail', wallet: {name: 'Rabby'}},
		});

		expect(selection.status).toBe('found');
		expect(selection.status === 'found' && selection.sender.route).toBe('rail');
	});

	it('routes there while the rail is DORMANT, which is its normal state', () => {
		// The rail disconnects after every payment, so the executor it exposes is
		// `not-connected` almost always. Selection must not care: the caller wakes
		// the route first and reads the executor after.
		const {senders} = harness();
		const rail = senders.find((sender) => sender.route === 'rail')!;
		expect(get(rail.executor).status).toBe('not-connected');

		const selection = selectSender(senders, {
			from: PAYER,
			source: {route: 'rail'},
		});
		expect(selection.status === 'found' && selection.sender.route).toBe('rail');
	});

	it('exposes the payer as the sender once the rail holds one', () => {
		const {senders} = harness({payer: PAYER});
		const rail = senders.find((sender) => sender.route === 'rail')!;
		const state = get(rail.executor);

		// The PAYER, not the signed-in account: this is the address that owns the
		// nonce being replaced.
		expect(state.status === 'ready' && state.address).toBe(PAYER);
	});

	it('does not fall back to the account executor for a signer transaction', () => {
		// Three routes are registered, so the no-source fallback cannot apply and
		// the recorded route decides. A signer transaction going to the account
		// route would ask a wallet to sign for a key it has never held.
		const {senders} = harness();
		const selection = selectSender(senders, {
			from: SIGNER,
			source: {route: 'signer'},
		});
		expect(selection.status === 'found' && selection.sender.route).toBe(
			'signer',
		);
	});
});

describe('how each route makes itself able to sign again', () => {
	it('signs the SIGNER in, rather than asking a wallet for an address', async () => {
		// THE POINT OF COMPOSING `ensureCanSign` PER SENDER. The signer's key is
		// derived at sign-in and held by the app: there is no wallet to name and no
		// address to select inside one. Asking `ensureConnected` for an address
		// here would send a wallet looking for an account it has never heard of and
		// park on `addressUnavailable` waiting for a switch that cannot happen.
		const {senders, connection} = harness();
		const signer = senders.find((sender) => sender.route === 'signer')!;

		await signer.ensureCanSign!({address: SIGNER});

		expect(connection.ensureConnected).toHaveBeenCalledOnce();
		// NO ARGUMENTS AT ALL: no step, and above all no mechanism. The step is
		// omitted deliberately too, so the connection drives to its own target
		// (`SignedIn` here), which is what derives the key.
		expect(connection.ensureConnected.mock.calls[0]).toEqual([]);
	});

	it('asks the wallet for the ACCOUNT, naming the recorded wallet', async () => {
		const {senders, connection} = harness();
		const account = senders.find((sender) => sender.route === 'account')!;

		await account.ensureCanSign!({address: ACCOUNT, wallet: {name: 'Rabby'}});

		const [step, mechanism] = connection.ensureConnected.mock
			.calls[0] as unknown as [
			string,
			{type: string; name?: string; address: `0x${string}`},
		];
		expect(step).toBe('WalletConnected');
		// The PAIR is what a replacement needs: the address alone lands on whatever
		// wallet is connected, the wallet alone on whatever account it is showing.
		expect(mechanism).toMatchObject({
			type: 'wallet',
			name: 'Rabby',
			address: ACCOUNT,
		});
	});

	it('asks the RAIL\u2019s own connection, not the app\u2019s', async () => {
		// The payer is a second wallet on a second connection, and is routinely not
		// the wallet the user is signed in with. Asking the app connection to
		// produce the payer's address would be a wallet parked forever on an
		// address it has never held.
		const {senders, connection, paymentConnection} = harness();
		const rail = senders.find((sender) => sender.route === 'rail')!;

		await rail.ensureCanSign!({address: PAYER, wallet: {name: 'Rainbow'}});

		expect(paymentConnection.ensureConnected).toHaveBeenCalledOnce();
		expect(connection.ensureConnected).not.toHaveBeenCalled();
	});

	it('remembers the app wallet and deliberately forgets the payer', async () => {
		// OPPOSITE ON PURPOSE, and silent either way round. The app connection
		// auto-connects to the wallet it last used, so recovering it must not clear
		// that; the rail clears its payer before every payment so the user picks
		// afresh, so persisting one here would reintroduce the sticky payer that
		// clearing exists to prevent.
		const {senders, connection, paymentConnection} = harness();
		const account = senders.find((sender) => sender.route === 'account')!;
		const rail = senders.find((sender) => sender.route === 'rail')!;

		await account.ensureCanSign!({address: ACCOUNT});
		await rail.ensureCanSign!({address: PAYER});

		const optionsOf = (fn: {mock: {calls: unknown[][]}}) =>
			fn.mock.calls[0][2] as {doNotStoreLocally?: boolean};
		expect(optionsOf(connection.ensureConnected).doNotStoreLocally).toBe(false);
		expect(optionsOf(paymentConnection.ensureConnected).doNotStoreLocally).toBe(
			true,
		);
	});
});
