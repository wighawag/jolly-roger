import {deployments} from '$lib/deployments-store';
import {
	createConnection,
	type ConnectionStore,
	type UnderlyingEthereumProvider,
} from '@etherplay/connect';
import {derived} from 'svelte/store';
import {createPublicClient, createWalletClient, custom} from 'viem';
import {createRpcFaultFlag, wrapProviderWithFault} from './rpc-fault';
import type {
	Account,
	ChainInfo,
	EstablishedConnection,
	OptionalSigner,
	TypedPublicClient,
	TypedWalletClient,
} from './types';

/**
 * Options controlling how the connection authenticates.
 *
 * `walletHost` presence selects the auth target: set => hosted sign-in
 * ('SignedIn', enabling email/social + a local signer); empty =>
 * wallet-only ('WalletConnected'). Both cases are unified under the same
 * store type below so consumers do not branch on it.
 */
export type ChainConnectionOptions = {
	nodeURL?: string;
	walletHost?: string;
};

/**
 * The connection store: a discriminated union of the two configurations this
 * app can create (discriminants: `targetStep` / `walletOnly`).
 *
 * - `'SignedIn'`: hosted sign-in enabled (walletHost set): email/social login
 *   plus a local signer.
 * - `'WalletConnected'`: wallet-only authentication (no walletHost).
 *
 * Both variants share the same store VALUE type (`Connection`), so `$connection`
 * reads are uniform; only methods like `ensureConnected`/`isTargetStepReached`
 * differ in how far they promise to take the user. Code needing the SignedIn
 * surface narrows first, e.g. `connection.targetStep === 'SignedIn'`.
 */
export type ChainConnection =
	| ConnectionStore<UnderlyingEthereumProvider, 'SignedIn', false>
	| ConnectionStore<UnderlyingEthereumProvider, 'WalletConnected', true>;

/**
 * Create the PAYMENT connection: a second, independent connection used only to
 * pay.
 *
 * Separate from the app connection because the payer is not necessarily the
 * player. Credits are bought for a signer, and the wallet that funds them may
 * be a different account, a different device's wallet, or eventually a card
 * processor acting on the user's behalf. Sharing one connection would force the
 * player to disconnect and reconnect as the payer to buy anything, and would
 * overwrite the session they are playing in.
 *
 * Differences from the app connection, all deliberate:
 * - `targetStep: 'WalletConnected'`: paying needs a wallet that can sign a
 *   transaction, not an identity. There is nothing to sign in to.
 * - `autoConnect: false`: this must stay dormant until the user asks to pay.
 *   Auto-connecting would pop a wallet prompt on page load for a purchase
 *   nobody has started.
 * - `useCurrentAccount: 'always'`: a payment is a one-shot act, so it uses
 *   whatever account the wallet has selected rather than putting an account
 *   picker in front of it.
 * - `storagePrefix`: REQUIRED for correctness, not tidiness. Both connections
 *   persist "the wallet I last used", and without a prefix they share one slot:
 *   paying with a different wallet than the player signed in with would leave
 *   the app auto-reconnecting the player as the payer on the next page load.
 *   Prefixing gives each connection its own slot, which is also what makes it
 *   safe for the payment connection to remember its payer between purchases.
 */
export function createPaymentConnection(
	chainInfo: ChainInfo,
	options?: {nodeURL?: string},
) {
	return createConnection({
		targetStep: 'WalletConnected',
		nodeURL: options?.nodeURL,
		chainInfo,
		storagePrefix: PAYMENT_STORAGE_PREFIX,
		prioritizeWalletProvider: true,
		useCurrentAccount: 'always',
		autoConnect: false,
	});
}

/**
 * Create the app's connection store.
 *
 * This is the single place the connection is configured. Its return type is
 * re-exported as `ChainConnection` (see ./types): the union of the two
 * possible configurations, so enabling hosted sign-in via `walletHost` never
 * requires touching type definitions elsewhere. `walletHost` is env-derived
 * (see core/connection/mode).
 */
export function createChainConnection(
	chainInfo: ChainInfo,
	options?: ChainConnectionOptions,
): ChainConnection {
	const {nodeURL, walletHost} = options ?? {};

	// Note: `useCurrentAccount` is intentionally omitted. Setting it would make
	// the connection auto-pick an account and skip `ChooseWalletAccount`, so a
	// wallet exposing several accounts would never let the user choose. Omitting
	// it routes multi-account wallets to the account picker; single-account
	// wallets still go straight to `WalletConnected` (the confirm step).
	if (walletHost) {
		return createConnection({
			targetStep: 'SignedIn',
			walletHost,
			nodeURL,
			chainInfo,
			prioritizeWalletProvider: true,
			autoConnect: true,
		});
	}

	// Wallet-only auth: the store targets (and never advances past)
	// 'WalletConnected'.
	return createConnection({
		targetStep: 'WalletConnected',
		nodeURL,
		chainInfo,
		prioritizeWalletProvider: true,
		autoConnect: true,
	});
}

/**
 * Namespace for the payment connection's persisted state. The app connection
 * deliberately has none, so it keeps the unprefixed keys it has always used and
 * existing sessions survive.
 */
export const PAYMENT_STORAGE_PREFIX = 'payment:';

/**
 * The payment connection plus the clients bound to it.
 */
export type PaymentRail = {
	connection: ReturnType<typeof createPaymentConnection>;
	walletClient: TypedWalletClient;
	publicClient: TypedPublicClient;
};

/**
 * Hands out the payment rail, building it the first time it is asked for.
 *
 * Lazy because there is nothing for it to do until someone pays. Building it
 * costs a connection, two viem clients and a round of EIP-6963 wallet
 * discovery, and an `autoConnect: false` connection will not have used any of
 * that: the overwhelming majority of sessions never buy anything, and they now
 * pay nothing for the ability to.
 *
 * Historical note, because it explains why this is a provider rather than a
 * plain field: until @etherplay/connect 0.2.0, a second connection built during
 * startup also CORRUPTED the first one's wallet list. Discovery is a page-wide
 * conversation (dispatch `eip6963:requestProvider`, collect announcements), and
 * the second connection's request made every wallet announce itself again while
 * the first was still listening, which the first appended without
 * deduplicating. A user with one wallet was shown "2 wallets available, choose
 * one", listing it twice. 0.2.0 deduplicates by uuid/rdns, so deferring is no
 * longer load-bearing for correctness - it is now only the cost argument above.
 *
 * `materialised` is exposed so the "nothing is built until it is needed"
 * contract can be asserted rather than assumed (a server render in particular
 * must build nothing; see ADR-0002).
 */
export type PaymentRailProvider = {
	get(): PaymentRail;
	readonly materialised: boolean;
};

export function createPaymentRailProvider(
	chainInfo: ChainInfo,
	options?: {nodeURL?: string},
): PaymentRailProvider {
	let rail: PaymentRail | undefined;
	return {
		get() {
			if (!rail) {
				const connection = createPaymentConnection(chainInfo, options);
				rail = {
					connection,
					walletClient: createWalletClient({
						chain: chainInfo,
						transport: custom(connection.provider),
					}),
					publicClient: createPublicClient({
						chain: chainInfo,
						transport: custom(connection.provider),
					}) as TypedPublicClient,
				};
			}
			return rail;
		},
		get materialised() {
			return rail !== undefined;
		},
	};
}

/**
 * Build the connection and the clients that hang off it.
 *
 * Synchronous on purpose: `createConnection` returns immediately in an
 * `{step: 'Idle', loading: true}` state and resolves into itself in the
 * background, so there is nothing to await here. Connecting is user-interactive
 * and can fail, which makes it precisely the wrong thing to block construction
 * on. Readiness is read from the store instead. See ADR-0002.
 */
export function establishRemoteConnection(options?: {
	nodeURL?: string;
	chainInfoNodeURL?: string;
	walletHost?: string;
}): EstablishedConnection {
	// Use deployments.get() for synchronous access
	const currentDeployments = deployments.get();

	// Cast to ChainInfo to preserve the literal type even when modifying rpcUrls.
	// The structure is the same, just the RPC URL may change. An empty
	// `rpcUrls.default.http` is a valid, supported state: when no RPC is baked in
	// (and no PUBLIC_NODE_URL is set) the connection falls back to the user's
	// wallet provider (prioritizeWalletProvider), so this is never an error.
	const chainInfo: ChainInfo = options?.chainInfoNodeURL
		? ({
				...currentDeployments.chain,
				rpcUrls: {
					...currentDeployments.chain.rpcUrls,
					default: {
						...currentDeployments.chain.rpcUrls.default,
						http: [options.chainInfoNodeURL],
					},
				},
			} as ChainInfo)
		: currentDeployments.chain;

	const connection = createChainConnection(chainInfo, {
		nodeURL: options?.nodeURL,
		walletHost: options?.walletHost,
	});

	// Debug-only RPC fault injection: a runtime flag (exposed on the context as
	// `forceRpcFailure`) that makes every request fail while set. Wrapping the
	// provider means all clients below fail together, like a real outage.
	const forceRpcFailure = createRpcFaultFlag();
	const faultyProvider = wrapProviderWithFault(
		connection.provider,
		forceRpcFailure,
	);

	const walletClient = createWalletClient({
		chain: chainInfo,
		transport: custom(faultyProvider),
	});

	const publicClient = createPublicClient({
		chain: chainInfo,
		transport: custom(faultyProvider),
	}) as TypedPublicClient;

	// Payment rail: built on FIRST USE, not here. See createPaymentRailProvider.
	// It shares the app's chainInfo (including the wallet-facing RPC url) but gets
	// its own provider, so its clients bypass the fault-injection wrapper above:
	// forcing an RPC outage is a debug tool for the app's own reads, not a way to
	// break payments.
	const payment = createPaymentRailProvider(chainInfo, {
		nodeURL: options?.nodeURL,
	});

	const account = derived<typeof connection, Account>(
		connection,
		($connection) => {
			return 'account' in $connection ? $connection.account.address : undefined;
		},
	);

	const signer = derived<typeof connection, OptionalSigner>(
		connection,
		($connection) => {
			return $connection.step === 'SignedIn'
				? {
						owner: $connection.account.address,
						address: $connection.account.signer.address,
						privateKey: $connection.account.signer.privateKey,
					}
				: undefined;
		},
	);

	return {
		connection,
		walletClient,
		publicClient,
		account,
		signer,
		payment,
		deployments, // Use the imported HMR-aware store
		forceRpcFailure,
	};
}
