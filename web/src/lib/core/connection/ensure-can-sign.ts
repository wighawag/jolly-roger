import {get, type Readable} from 'svelte/store';
import {
	walletNameToReopen,
	type AnnouncedWallet,
	type WalletIdentity,
} from './tx-source';

/**
 * The connection surface this needs, structural so both the app connection and
 * the payment rail fit despite being differently-typed stores.
 *
 * The mechanism is spelled as the two SHAPES actually passed rather than one
 * with both fields optional: `WalletMechanism` pairs its parameters (a present
 * name with a present address, or neither), so `name?: string` matches none of
 * its instantiations and the call site would need a cast.
 */
export type SignableConnection = {
	subscribe: Readable<unknown>['subscribe'];
	ensureConnected: (
		step: 'WalletConnected',
		mechanism?:
			| {type: 'wallet'; name: string; address: `0x${string}`}
			| {type: 'wallet'; name?: undefined; address: `0x${string}`},
		options?: {doNotStoreLocally?: boolean},
	) => Promise<unknown>;
};

type ConnectionSnapshot = {wallets?: readonly AnnouncedWallet[]};

/**
 * Get a connection back to a SPECIFIC account, so it can sign again for a
 * transaction it already sent.
 *
 * This is the recovery half of {@link TxSource}. Recording which route signed a
 * transaction is only useful if that route can be reopened, and reopening it is
 * done the way the rest of the app connects: `ensureConnected`, called by the
 * action that needs it, exactly as `setGreeting` and `contractCall` do.
 *
 * CALLED UNCONDITIONALLY, WITH NO "ARE WE ALREADY THERE" CHECK IN FRONT OF IT.
 * There was one, and it was a bug. It compared `connection.account.address`,
 * which is the address the connection AGREED on, not the one the wallet can
 * sign with now: @etherplay/connect leaves `account` untouched when the wallet
 * locks or the user switches account behind its back, recording that in
 * `wallet.status` and `wallet.accountChanged` instead (`remote.ts` documents
 * exactly this on `payerAddressOf`). So the check passed for a LOCKED wallet,
 * skipped the one call that would have prompted the user to unlock, let the
 * send go out, and got back `code: 4001` from the provider, which this app then
 * reported as "Transaction rejected by user" about a prompt nobody was shown.
 *
 * Asking every time costs nothing: `ensureConnected` resolves immediately when
 * the connection is already usable, and knows how to reconnect a locked or
 * disconnected wallet when it is not. Restating that judgement here could only
 * ever disagree with it.
 *
 * The one thing this adds over a bare `ensureConnected()` is the MECHANISM. A
 * `WalletMechanism` carries both the wallet and the address, which is exactly
 * the pair a replacement needs and exactly the pair that would otherwise be
 * lost: the payment rail disconnects after every payment so the picker appears
 * next time, so without the recorded identity the user would be asked to
 * remember which wallet they paid with, and picking wrong fails opaquely.
 *
 * Why not discover the wallet instead, by asking each announced one which
 * accounts it holds: a locked wallet answers `eth_accounts` with an empty list,
 * and someone with a stuck transaction is disproportionately likely to have a
 * locked wallet. The recorded identity works when discovery cannot.
 *
 * THROWS the way `ensureConnected` throws, and deliberately does not translate:
 * the caller already distinguishes a refusal from a real failure
 * (`isUserRejectionError`, `connectionRefusal`) because every other send in this
 * app has to.
 *
 * RESOLVING NOW MEANS THE ADDRESS WAS REACHED. Since @etherplay/connect 0.12.0
 * the address and wallet name are part of what satisfies `ensureConnected`
 * rather than a hint it may ignore, so a connection resting at the right step
 * on the wrong account no longer resolves instantly having done nothing. A
 * wallet that cannot offer the address rests on `connection.addressUnavailable`
 * for the user to read and answer, and this call settles only when they do. The
 * caller still re-checks its executor afterwards, not because that is expected
 * to fire, but because the cost of being wrong is broadcasting a fresh
 * transaction at another account's nonce.
 *
 * `remember` IS REQUIRED, because there is no safe default and the two
 * connections in this app want opposite things.
 *
 * The app connection persists "the wallet I last used" and auto-connects to it;
 * recovering it must keep doing so, or unsticking one transaction quietly costs
 * the user their remembered wallet and they are asked to pick it again on the
 * next load. The payment rail clears that slot before every payment on purpose,
 * so that who pays is chosen afresh, and re-persisting a payer here would
 * reintroduce the sticky-payer bug that clearing exists to prevent.
 *
 * So: `true` for a connection whose wallet is the user's identity, `false` for
 * one whose wallet is a choice they make per payment. Defaulting either way
 * silently breaks the other, which is why this is not defaulted at all.
 */
export async function ensureCanSignAs(
	connection: SignableConnection,
	target: {address: `0x${string}`; wallet?: WalletIdentity},
	options: {remember: boolean},
): Promise<void> {
	const wallets = (get(connection) as ConnectionSnapshot | undefined)?.wallets;
	const name = walletNameToReopen(wallets, target.wallet);

	const address = target.address;

	await connection.ensureConnected(
		'WalletConnected',
		name ? {type: 'wallet', name, address} : {type: 'wallet', address},
		{doNotStoreLocally: !options.remember},
	);
}
