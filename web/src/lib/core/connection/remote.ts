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

export async function establishRemoteConnection(options?: {
	nodeURL?: string;
	chainInfoNodeURL?: string;
	walletHost?: string;
}): Promise<EstablishedConnection> {
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
		deployments, // Use the imported HMR-aware store
		forceRpcFailure,
	};
}
