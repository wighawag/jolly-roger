import {derived, type Readable} from 'svelte/store';
import type {Account, Transport} from 'viem';
import type {TrackedWalletClientAutoPopulate} from '@etherkit/viem-tx-tracker';
import type {TransactionMetadata} from '$lib/account/AccountData';
import type {ChainConnection, ChainInfo} from './types';

/**
 * The transaction executor.
 *
 * A single, mode-agnostic front for sending transactions. Call sites use it
 * instead of reaching into the connection + wallet client directly, so they do
 * not have to know whether the app sends from the connected wallet account or
 * from a local signer.
 *
 * The executor's `client` is a real tracked viem wallet client, so all viem
 * type inference (abitype-driven `functionName`/`args`, typed returns) and the
 * tx-tracker metadata still apply at the call site. Only the underlying
 * transport/account differ between modes, which is invisible to the types.
 *
 * An executor is pinned to WHO SIGNS, chosen at construction, and the app
 * builds one of each (see lib/context). There is no mode: a call site picks the
 * executor whose account is the right one for what it is doing.
 *
 * - `account`: send from the authenticated account, via the connection
 *   provider. An account with no wallet (email/social sign-in) resolves to
 *   `cannot-send`, because there is nothing to sign with.
 * - `signer`: send from the local signer (a private key derived at sign-in),
 *   using the client built by the caller-supplied {@link SignerClientFactory}
 *   (typically broadcasting over the node RPC). Never `cannot-send`: either
 *   there is a signer and it can always sign, or the app does not sign in at
 *   all and this stays `not-connected` for its whole life.
 */

/**
 * The executor's tracked wallet client.
 *
 * Same shape the rest of the app uses (`context.walletClient`), but generic
 * over the transport: the wallet-mode client rides the connection provider
 * (`custom` transport) while a signer-mode client typically uses `http`. The
 * chain stays pinned to the app's `ChainInfo`, so viem's
 * `writeContract`/`sendTransaction` generics (abitype inference, optional
 * `chain`) apply unchanged at call sites.
 */
export type ExecutorClient = TrackedWalletClientAutoPopulate<
	TransactionMetadata,
	Transport,
	ChainInfo,
	Account | undefined
>;

export type ExecutorState =
	/** No account connected yet: nothing can be sent. */
	| {status: 'not-connected'}
	/**
	 * Ready to send.
	 * - `address`: the `from` address (for display, balance, gas estimation).
	 * - `account`: what to pass to `writeContract`/`sendTransaction` as `account`.
	 *   In signer mode this is a viem Local Account (so viem signs locally and
	 *   broadcasts via `eth_sendRawTransaction`); in wallet mode it is the address
	 *   string (a JSON-RPC account, so the wallet signs via `eth_sendTransaction`).
	 * - `client`: the tracked wallet client to send through.
	 */
	| {
			status: 'ready';
			address: `0x${string}`;
			account: Account | `0x${string}`;
			client: ExecutorClient;
	  }
	/**
	 * The connected account cannot send under the current execution mode (e.g.
	 * an email/social account under `wallet` execution). Call sites surface this
	 * as a friendly modal instead of a raw RPC error.
	 */
	| {status: 'cannot-send'};

export type ExecutorStore = Readable<ExecutorState>;

/**
 * Builds the tracked client + account used in signer execution mode.
 *
 * Supplied by the caller (see lib/context) so that the concrete viem client
 * construction, with its precisely-known transport/chain/account types and the
 * app's tx-tracking wiring, lives where those types are in scope. The executor
 * itself stays free of client construction (and of type casts).
 *
 * Called once per distinct private key; the executor caches the result.
 */
export type SignerClientFactory = (privateKey: `0x${string}`) => {
	client: ExecutorClient;
	account: Account;
};

/**
 * Wrap a signer-client factory so that one key yields one client OBJECT.
 *
 * Not an optimisation. Every executor pointed at the same signer must get the
 * literally same client, because transaction tracking attaches listeners per
 * client and identifies them by reference (see account/connectors). Two objects
 * for one key means the second is a client nobody listens to, and everything it
 * sends silently never reaches the user's transaction list. That failure is
 * invisible: the transactions still go through, they just stop being reported.
 *
 * One key at a time, deliberately: re-signing in as a different identity
 * derives a different key, and the old client must fall out of use rather than
 * linger in a map keyed by a stale secret.
 */
export function memoiseSignerClient(
	build: SignerClientFactory,
): SignerClientFactory {
	let key: string | undefined;
	let cached: ReturnType<SignerClientFactory> | undefined;
	return (privateKey) => {
		if (key !== privateKey || !cached) {
			cached = build(privateKey);
			key = privateKey;
		}
		return cached;
	};
}

export function createExecutor(params: {
	connection: ChainConnection;
	/** Tracked client bound to the connection provider (account execution). */
	walletClient: ExecutorClient;
	/** Which account this executor sends from. */
	sendFrom: 'account' | 'signer';
	/**
	 * Builds the signer client (see {@link SignerClientFactory}).
	 *
	 * Expected to be memoised BY THE CALLER, so that every executor asking for
	 * the same key gets the same client object. Transaction tracking identifies
	 * clients by reference, so two objects for one key means one of them is
	 * untracked. This function no longer caches internally, precisely so that
	 * responsibility sits in one place instead of once per executor.
	 */
	buildSignerClient: SignerClientFactory;
}): ExecutorStore {
	const {connection, walletClient, sendFrom, buildSignerClient} = params;

	return derived<ChainConnection, ExecutorState>(
		connection,
		($connection): ExecutorState => {
			const hasAccount = 'account' in $connection && !!$connection.account;
			if (!hasAccount) return {status: 'not-connected'};

			if (sendFrom === 'signer') {
				// Requires a local signer, only present once SignedIn.
				if ($connection.step === 'SignedIn') {
					const {client, account} = buildSignerClient(
						$connection.account.signer.privateKey,
					);
					return {
						status: 'ready',
						address: $connection.account.signer.address,
						account,
						client,
					};
				}
				// Either the signature is not in yet (the sign-in flow will produce
				// one), or this app never signs in and there will never be a signer.
				// Both are "nothing to send with", which a call site already handles.
				return {status: 'not-connected'};
			}

			// account execution: send from the authenticated account.
			// Requires a wallet provider; email/social accounts (SignedIn without a
			// wallet) cannot send directly. The address string is a JSON-RPC account,
			// so the wallet signs via eth_sendTransaction.
			const hasWallet = 'wallet' in $connection && !!$connection.wallet;
			if (!hasWallet) return {status: 'cannot-send'};

			return {
				status: 'ready',
				address: $connection.account.address,
				account: $connection.account.address,
				client: walletClient,
			};
		},
	);
}
