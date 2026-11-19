import {derived} from 'svelte/store';
import type {BalanceStore} from '$lib/core/connection/balance';
import type {ExecutorState, ExecutorStore} from '$lib/core/connection/executor';
import {
	ensureCanSignAs,
	type SignableConnection,
} from '$lib/core/connection/ensure-can-sign';
import type {SenderRegistry} from '$lib/core/connection/senders';
import {payerAddressOf} from '$lib/core/connection/remote';
import type {TrackedPaymentRail} from './types';

/**
 * THE THREE ROUTES THIS APP SENDS FROM, as the list a stuck transaction is
 * replaced through.
 *
 * A FILE OF ITS OWN, not because `context/core.ts` was short of room, but
 * because this is the one piece of that file with a decision per line and no
 * way to reach it from a test. `createCoreContext` builds a chain, a
 * connection, a tracker and a dozen stores; nothing that needs a live chain
 * should stand between a test and the question "does a rail payment route to
 * the rail". Every value here arrives as a parameter, so the answer is one call
 * away. See test/lib/context/sender-registry.test.ts.
 *
 * WHAT MAKES IT WORTH GUARDING: a route that can send and is not registered can
 * never replace its own transactions, and nothing fails when that happens. No
 * type is violated, no test goes red, and the user finds out months later when
 * a stuck payment tells them their own money belongs to somebody else. That is
 * not a hypothetical: it is the bug this whole mechanism was written for.
 *
 * See core/connection/senders for the registry contract, and
 * core/connection/tx-source for why the route is recorded rather than
 * rediscovered.
 */

/**
 * The app's own connection, which BOTH kinds of call reach.
 *
 * An intersection rather than one signature, because the two routes ask it
 * different questions: the wallet route names a step, a wallet and an address
 * (see {@link SignableConnection}), and the signer route asks for nothing at
 * all and takes the connection's own target step. The real connection offers
 * both as overloads; spelling only one here would make the other a cast.
 */
export type AppConnection = SignableConnection & {
	ensureConnected: () => Promise<unknown>;
};

export type SenderRegistryParams = {
	connection: AppConnection;
	payment: TrackedPaymentRail;
	accountExecutor: ExecutorStore;
	signerExecutor: ExecutorStore;
	accountBalance: BalanceStore;
	signerBalance: BalanceStore;
	payerBalance: BalanceStore;
};

/**
 * The payment rail AS A SENDER, which it has always been in fact and never in
 * the registry.
 *
 * NOT `createExecutor`, whose two modes (`account`, `signer`) are both pinned to
 * the APP's connection. The rail is a second connection with its own payer, so
 * there is nothing there to reuse; what a sender needs from an executor is only
 * "who signs, with which client, and is it ready", and for the rail that is one
 * derivation of its own connection.
 *
 * `not-connected` while dormant is the honest answer and the right one: the rail
 * holds nobody between payments by design. The replacement path does not read
 * this until after `ensureCanSign` has reconnected the payer, so a dormant rail
 * is not a dead end, it is a wallet prompt away. That is the whole difference
 * between this and the address-scan it replaces, which could only ever see the
 * routes that were already awake.
 */
export function railExecutorOf(payment: TrackedPaymentRail): ExecutorStore {
	return derived(payment.connection, ($payment): ExecutorState => {
		const address = payerAddressOf($payment);
		if (!address) return {status: 'not-connected'};
		return {
			status: 'ready',
			address,
			account: address,
			client: payment.walletClient,
		};
	});
}

export function createSenderRegistry(
	params: SenderRegistryParams,
): SenderRegistry {
	const {
		connection,
		payment,
		accountExecutor,
		signerExecutor,
		accountBalance,
		signerBalance,
		payerBalance,
	} = params;

	return [
		{
			route: 'account',
			executor: accountExecutor,
			balance: accountBalance,
			// `remember: true`: this is the user's own wallet, and the app connection
			// auto-connects to whichever it saw last. Recovering it must leave that
			// intact, or unsticking one transaction quietly costs them the
			// remembered wallet and they are asked to pick it again next load.
			ensureCanSign: (target) =>
				ensureCanSignAs(connection, target, {remember: true}),
		},
		{
			route: 'signer',
			executor: signerExecutor,
			balance: signerBalance,
			// NOT `ensureCanSignAs`, and this is the case that proves why
			// `ensureCanSign` is composed per sender rather than derived from the
			// route. The signer has no wallet to name and no address to select
			// inside one: its key is derived at sign-in and held by the app. Naming
			// an address here would ask a wallet to produce an account it has never
			// heard of, and park on `addressUnavailable` waiting for a switch that
			// cannot happen.
			//
			// What it needs is simply to BE signed in, which is what a bare
			// `ensureConnected()` drives to: this app's target step is `SignedIn`,
			// and reaching it is what derives the key in the first place. The step is
			// deliberately not named, because an app configured to stop at
			// `WalletConnected` has no `SignedIn` overload to ask for. That is also
			// why core does not hardcode one.
			ensureCanSign: () => connection.ensureConnected().then(() => {}),
		},
		{
			route: 'rail',
			executor: railExecutorOf(payment),
			balance: payerBalance,
			// `remember: false`, THE OPPOSITE OF THE ACCOUNT ROUTE, and deliberately.
			// The rail disconnects after every payment so the user re-picks a payer,
			// and persisting one here would put it straight back into the slot that
			// clearing exists to empty: the next payment would silently reuse this
			// payer. That is the sticky-payer bug, reintroduced through the recovery
			// path, where nobody would think to look for it.
			ensureCanSign: (target) =>
				ensureCanSignAs(payment.connection, target, {remember: false}),
		},
	];
}
