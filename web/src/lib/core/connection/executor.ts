import {derived, type Readable} from 'svelte/store';
import type {Account, Transport} from 'viem';
import type {TrackedWalletClientAutoPopulate} from '@etherkit/viem-tx-tracker';
import type {TransactionMetadata} from '$lib/account/AccountData';
import type {ChainConnection, ChainInfo} from './types';

/**
 * The transaction executor: sends from the AUTHENTICATED ACCOUNT.
 *
 * Call sites use it instead of reaching into the connection and wallet client
 * directly, so they do not have to assemble the `from` address, the account
 * argument and the client themselves, and so "who is paying for this" has one
 * answer the whole app agrees on.
 *
 * Named for whose key signs, not for a mode. This app has exactly one answer to
 * that - the account the user authenticated as - and no configuration changes
 * it. An app that also acts on the user's behalf between prompts wants a second
 * executor backed by a local signer, which is a different thing rather than a
 * setting on this one; see the signer variant of this template.
 *
 * The executor's `client` is a real tracked viem wallet client, so all viem
 * type inference (abitype-driven `functionName`/`args`, typed returns) and the
 * tx-tracker metadata still apply at the call site.
 */

/**
 * The executor's tracked wallet client.
 *
 * Same shape the rest of the app uses (`context.walletClient`), but generic
 * over the transport, so a variant that broadcasts over `http` rather than the
 * connection provider can reuse this type unchanged. The chain stays pinned to
 * the app's `ChainInfo`, so viem's `writeContract`/`sendTransaction` generics
 * (abitype inference, optional `chain`) apply unchanged at call sites.
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
	 * - `account`: what to pass to `writeContract`/`sendTransaction` as
	 *   `account`. An address string here, i.e. a JSON-RPC account, so the
	 *   wallet signs via `eth_sendTransaction`.
	 * - `client`: the tracked wallet client to send through.
	 */
	| {
			status: 'ready';
			address: `0x${string}`;
			account: Account | `0x${string}`;
			client: ExecutorClient;
	  }
	/**
	 * The connected account cannot send: it authenticated without a wallet, so
	 * there is nothing to sign with. Call sites surface this as a friendly
	 * notice instead of a raw RPC error.
	 */
	| {status: 'cannot-send'};

export type ExecutorStore = Readable<ExecutorState>;

export function createExecutor(params: {
	connection: ChainConnection;
	/** Tracked client bound to the connection provider. */
	walletClient: ExecutorClient;
}): ExecutorStore {
	const {connection, walletClient} = params;

	return derived<ChainConnection, ExecutorState>(
		connection,
		($connection): ExecutorState => {
			const hasAccount = 'account' in $connection && !!$connection.account;
			if (!hasAccount) return {status: 'not-connected'};

			// Sending needs a wallet provider to sign with. An account
			// authenticated by email or social login has none, which is a real
			// state to report rather than an error: it is the app's job to say so.
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
