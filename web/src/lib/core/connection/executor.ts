import {derived, type Readable} from 'svelte/store';
import type {Account, Transport} from 'viem';
import type {TrackedWalletClientAutoPopulate} from '@etherkit/viem-tx-tracker';
import type {TransactionMetadata} from '$lib/account/AccountData';
import {isDispatchGuarded} from '$lib/core/transaction/dispatch-guard';
import type {TxSource} from './tx-source';
import type {ChainConnection, ChainInfo} from './types';

/**
 * The transaction executor.
 *
 * A single, mode-agnostic front for sending transactions. Call sites use it
 * instead of reaching into the connection and wallet client directly, so they
 * do not have to assemble the `from` address, the account argument and the
 * client themselves, and so "who is paying for this" has one answer the whole
 * app agrees on.
 *
 * An executor is pinned to WHO SIGNS, chosen at construction. There is no mode
 * and no default: which account a transaction comes from is a property of what
 * the transaction DOES, not of how the app is configured.
 *
 * - `account`: send from the authenticated account, via the connection
 *   provider. An account with no wallet (email/social sign-in) resolves to
 *   `cannot-send`, because there is nothing to sign with.
 * - `signer`: send from the local signer derived at sign-in, using the client
 *   built by the caller-supplied {@link SignerClientFactory} (typically
 *   broadcasting over the node RPC). Never `cannot-send`: either there is a
 *   signer and it can always sign, or the app does not sign in at all and this
 *   stays `not-connected` for its whole life.
 *
 * An app that never signs in simply never asks for the second kind, and the
 * code for it costs that app nothing (see TARGET_STEP in ./mode).
 *
 * The executor's `client` is a real tracked viem wallet client, so all viem
 * type inference (abitype-driven `functionName`/`args`, typed returns) and the
 * tx-tracker metadata still apply at the call site.
 */

/**
 * The executor's tracked wallet client.
 *
 * Same shape the rest of the app uses (`context.walletClient`), but generic
 * over the transport: the account-mode client rides the connection provider (a
 * `custom` transport) while a signer-mode client typically uses `http`. The
 * chain stays pinned to the app's `ChainInfo`, so viem's
 * `writeContract`/`sendTransaction` generics (abitype inference, optional
 * `chain`) apply unchanged at call sites.
 *
 * Carries a {@link TxSource}, so every transaction records WHICH ROUTE signed
 * it. That is what lets a stuck one be replaced later: see tx-source.
 */
export type ExecutorClient = TrackedWalletClientAutoPopulate<
	TransactionMetadata,
	Transport,
	ChainInfo,
	Account | undefined,
	TxSource
>;

export type ExecutorState =
	/** No account connected yet: nothing can be sent. */
	| {status: 'not-connected'}
	/**
	 * Ready to send.
	 * - `address`: the `from` address (for display, balance, gas estimation).
	 * - `account`: what to pass to `writeContract`/`sendTransaction` as `account`.
	 *   In signer mode a viem Local Account, so viem signs locally and broadcasts
	 *   via `eth_sendRawTransaction`; in account mode the address string, i.e. a
	 *   JSON-RPC account, so the wallet signs via `eth_sendTransaction`.
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

/**
 * Builds the tracked client + account used when sending from the local signer.
 *
 * Supplied by the caller (see lib/context) so that the concrete viem client
 * construction, with its precisely-known transport/chain/account types and the
 * app's tx-tracking wiring, lives where those types are in scope. The executor
 * itself stays free of client construction, and of type casts.
 *
 * Called once per distinct private key; see {@link memoiseSignerClient}.
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

/**
 * What an executor needs.
 *
 * `buildSignerClient` is optional because an app that never signs in has no
 * signer client to build and should not have to invent one; `sendFrom` is
 * required because who signs is never a default.
 *
 * This was briefly a union discriminated on `sendFrom`, which made the factory
 * required by the signer arm and refused by the account arm, so the mistake
 * below could not be written at all. That is the better guarantee and it was
 * given up on purpose: with `sendFrom` held in a variable (which every table
 * driven test and any generic wrapper does) the argument matches NEITHER arm,
 * so the type that was meant to prevent one error made ordinary callers
 * unwritable. The construction-time check below catches the same mistake at the
 * same moment for the cost of one line.
 */
export type ExecutorParams = {
	connection: ChainConnection;
	/** Tracked client bound to the connection provider. */
	walletClient: ExecutorClient;
	/** Which account this executor sends from. */
	sendFrom: 'account' | 'signer';
	/**
	 * Builds the signer client (see {@link SignerClientFactory}). Required when
	 * `sendFrom` is `'signer'`, unused otherwise.
	 *
	 * Expected to be memoised BY THE CALLER, so that every executor asking for
	 * the same key gets the same client object. Transaction tracking identifies
	 * clients by reference, so two objects for one key means one of them is
	 * untracked. This does not cache internally, precisely so that the
	 * responsibility sits in one place instead of once per executor.
	 */
	buildSignerClient?: SignerClientFactory;
};

/**
 * Clients already complained about, so a warning is not repeated for the life of
 * the session.
 *
 * The signer check below sits inside a `derived` callback, which re-runs on
 * every connection change: undeduped it would print on every reconnect, every
 * account switch and every step of the sign-in flow, and a warning that appears
 * dozens of times is one the reader learns to scroll past. A WeakSet, so
 * remembering a client cannot keep it alive.
 */
const warnedClients = new WeakSet<object>();

function warnIfUnguarded(
	client: unknown,
	sendFrom: ExecutorParams['sendFrom'],
): void {
	if (!import.meta.env.DEV) return;
	if (isDispatchGuarded(client)) return;
	if (typeof client === 'object' && client !== null) {
		if (warnedClients.has(client)) return;
		warnedClients.add(client);
	}

	console.warn(
		`[executor] the client for sendFrom "${sendFrom}" does not record ` +
			`transactions before dispatching them, so a reload between sending and ` +
			`receiving the hash loses the transaction. Wrap it with ` +
			`guardDispatch(client, inFlight) where it is built, INSIDE any ` +
			`memoisation, so one key still yields one client object. A signer whose ` +
			`key the app holds should pass {prompts: false}, so its silent sends are ` +
			`recorded without raising "Wallet Action Required". See ` +
			`core/transaction/dispatch-guard.`,
	);
}

export function createExecutor(params: ExecutorParams): ExecutorStore {
	const {connection, walletClient, sendFrom, buildSignerClient} = params;

	// Fail where the mistake is, not where it surfaces. Without this, an executor
	// asked to send from a signer it cannot build stays silently `not-connected`
	// until the user tries to send, and then dies inside a derived store on a
	// code path nobody was looking at.
	if (sendFrom === 'signer' && !buildSignerClient) {
		throw new Error(
			'createExecutor: sendFrom "signer" requires buildSignerClient',
		);
	}

	// FAIL LOUDLY IF A CLIENT DOES NOT RECORD BEFORE DISPATCH.
	//
	// `guardDispatch` is applied once, where the tracked client is built (see
	// lib/context), so everything in THIS app inherits it. A variant that builds a
	// SECOND tracked client for a local signer has to guard that one too, and
	// nothing can do it on its behalf. Unguarded, every transaction from that
	// signer is dispatched with no in-flight record, which is precisely the hole
	// this slice closed for the account executor, and it would be invisible: the
	// transactions still go through, they just stop being recoverable.
	//
	// A local signer guards with `guardDispatch(client, inFlight, {prompts:
	// false})`. It records, counts and warns before unload like any other send;
	// what it must not do is raise "Wallet Action Required", since it signs with a
	// key the app already has and there is no wallet and no human in the loop.
	//
	// A warning rather than a throw, because an app may legitimately compose an
	// executor before wiring the guard, and taking the app down for it would be a
	// worse trade than saying so. DEV only.
	warnIfUnguarded(walletClient, sendFrom);

	return derived<ChainConnection, ExecutorState>(
		connection,
		($connection): ExecutorState => {
			const hasAccount = 'account' in $connection && !!$connection.account;
			if (!hasAccount) return {status: 'not-connected'};

			if (sendFrom === 'signer') {
				// Requires a local signer, which only exists once SignedIn.
				if ($connection.step === 'SignedIn' && buildSignerClient) {
					const {client, account} = buildSignerClient(
						$connection.account.signer.privateKey,
					);
					// CHECKED HERE TOO, and this is the check that matters. The warning
					// above inspects the client this executor was HANDED; the signer's is
					// built by the factory, lazily, and never passes through it. So the
					// one client the warning exists to talk about was the one client it
					// could not see, which was confirmed by probe rather than argued:
					// unguarded factory, executor `ready`, no warning. See
					// work/notes/findings/executor-dev-warning-does-not-see-the-signer-client.md
					// on the `work` branch.
					warnIfUnguarded(client, sendFrom);
					return {
						status: 'ready',
						address: $connection.account.signer.address,
						account,
						client,
					};
				}
				// Either the signature is not in yet (the sign-in flow will produce
				// one), or this app never signs in and there will never be a signer.
				// Both are "nothing to send with", which call sites already handle.
				return {status: 'not-connected'};
			}

			// Sending from the authenticated account needs a wallet provider to sign
			// with. An account authenticated by email or social login has none, which
			// is a real state to report rather than an error: it is the app's job to
			// say so.
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
