import {deployments} from '$lib/deployments-store';
import {
	createConnection,
	type ConnectionStore,
	type UnderlyingEthereumProvider,
} from '@etherplay/connect';
import {derived} from 'svelte/store';
import {createPublicClient, createWalletClient, custom} from 'viem';
import {createRpcFaultFlag, wrapProviderWithFault} from './rpc-fault';
import type {TargetStep} from './mode';
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
 * `targetStep` is the app's own configuration (see ./mode), NOT derived from
 * `walletHost`. `walletHost` only adds the hosted mechanisms (email, social);
 * without one the connection still signs in, using a built-in wallet.
 */
export type ChainConnectionOptions = {
	nodeURL?: string;
	targetStep: TargetStep;
	walletHost?: string;
	walletOnly: boolean;
};

/**
 * The connection store: a discriminated union of the configurations this app
 * can create (discriminants: `targetStep` / `walletOnly`).
 *
 * - `'SignedIn'`: the user signs once and the app gains a local signer. With a
 *   `walletHost` that also enables email/social; without one it is wallet-only
 *   sign-in, which needs no backend at all (the signer is derived locally from
 *   the signature).
 * - `'WalletConnected'`: stop at a connected wallet. No signature, no signer.
 *
 * All variants share the same store VALUE type (`Connection`), so `$connection`
 * reads are uniform; only methods like `ensureConnected`/`isTargetStepReached`
 * differ in how far they promise to take the user. Code needing the SignedIn
 * surface narrows first, e.g. `connection.targetStep === 'SignedIn'`.
 */
export type ChainConnection =
	| ConnectionStore<UnderlyingEthereumProvider, 'SignedIn', false>
	| ConnectionStore<UnderlyingEthereumProvider, 'SignedIn', true>
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
 * re-exported as `ChainConnection` (see ./types): the union of the possible
 * configurations, so changing `TARGET_STEP` or adding a `walletHost` never
 * requires touching type definitions elsewhere.
 */
export function createChainConnection(
	chainInfo: ChainInfo,
	options: ChainConnectionOptions,
): ChainConnection {
	const {nodeURL, targetStep, walletHost, walletOnly} = options;

	// Note: `useCurrentAccount` is intentionally omitted. Setting it would make
	// the connection auto-pick an account and skip `ChooseWalletAccount`, so a
	// wallet exposing several accounts would never let the user choose. Omitting
	// it routes multi-account wallets to the account picker; single-account
	// wallets still go straight to `WalletConnected` (the confirm step).
	if (targetStep === 'SignedIn') {
		// Sign-in derives the local signer. Two flavours, chosen by whether a
		// hosted service is configured, and the store type covers both:
		//
		// - with a host: every mechanism, including email and social, which are
		//   popup flows served by that host.
		// - without one (`walletOnly`): built-in wallets only. Still a full
		//   sign-in, because the signer comes from a signature over an
		//   origin-scoped message that the wallet produces locally. No backend is
		//   involved, so this is a complete configuration rather than a degraded
		//   one.
		//
		// Branching on `walletHost` rather than on `walletOnly`, though they are
		// the same condition (see resolveConnectionConfig): the hosted overload
		// requires a `string`, and only testing the host itself narrows away the
		// `undefined`. This is also the one place where the host legitimately
		// decides something, since it decides which MECHANISMS exist, never the
		// target step.
		if (walletOnly || !walletHost) {
			return createConnection({
				targetStep: 'SignedIn',
				walletOnly: true,
				nodeURL,
				chainInfo,
				prioritizeWalletProvider: true,
				autoConnect: true,
			});
		}
		return createConnection({
			targetStep: 'SignedIn',
			walletHost,
			nodeURL,
			chainInfo,
			prioritizeWalletProvider: true,
			autoConnect: true,
		});
	}

	// No signer wanted: stop at a connected wallet, so the user is never asked
	// to sign anything they did not initiate.
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
 * The payment rail, built up front.
 *
 * It was briefly built on first use instead, to avoid a second connection
 * during startup: before @etherplay/connect 0.2.0 that corrupted the first
 * connection's wallet list (both dispatched the page-wide `eip6963` request and
 * announcements were appended without deduplication). 0.2.0 deduplicates, so
 * that reason is gone, and deferring turned out to cost something worse than it
 * saved: the flow UI is bound to a connection, and a connection that does not
 * exist yet cannot have one. Paying then hung with no dialog and no explanation
 * whenever the payment connection needed the user to choose between two
 * installed wallets.
 *
 * Still dormant: `autoConnect: false` means constructing it talks to nobody and
 * raises no wallet prompt. It only acts when something calls `ensureConnected`.
 */
export function createPaymentRail(
	chainInfo: ChainInfo,
	options?: {nodeURL?: string},
): PaymentRail {
	const connection = createPaymentConnection(chainInfo, options);
	return {
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

/**
 * Build the connection and the clients that hang off it.
 *
 * Synchronous on purpose: `createConnection` returns immediately in an
 * `{step: 'Idle', loading: true}` state and resolves into itself in the
 * background, so there is nothing to await here. Connecting is user-interactive
 * and can fail, which makes it precisely the wrong thing to block construction
 * on. Readiness is read from the store instead. See ADR-0002.
 */
export function establishRemoteConnection(options: {
	nodeURL?: string;
	chainInfoNodeURL?: string;
	targetStep: TargetStep;
	walletHost?: string;
	walletOnly: boolean;
}): EstablishedConnection {
	// Use deployments.get() for synchronous access
	const currentDeployments = deployments.get();

	// Cast to ChainInfo to preserve the literal type even when modifying rpcUrls.
	// The structure is the same, just the RPC URL may change. An empty
	// `rpcUrls.default.http` is a valid, supported state: when no RPC is baked in
	// (and no PUBLIC_NODE_URL is set) the connection falls back to the user's
	// wallet provider (prioritizeWalletProvider), so this is never an error.
	const chainInfo: ChainInfo = options.chainInfoNodeURL
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
		nodeURL: options.nodeURL,
		targetStep: options.targetStep,
		walletHost: options.walletHost,
		walletOnly: options.walletOnly,
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

	// Payment rail. Shares the app's chainInfo (including the wallet-facing RPC
	// url) but gets its own provider, so its clients bypass the fault-injection
	// wrapper above: forcing an RPC outage is a debug tool for the app's own
	// reads, not a way to break payments.
	const payment = createPaymentRail(chainInfo, {nodeURL: options.nodeURL});

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
