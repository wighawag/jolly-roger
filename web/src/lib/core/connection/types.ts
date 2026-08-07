import type {Readable} from 'svelte/store';
import type {
	Account as ViemAccount,
	Chain,
	CustomTransport,
	PublicClient,
	Transport,
	WalletClient,
} from 'viem';

// ============================================================================
// Re-export all deployment-related types from the centralized store
// ============================================================================

export type {
	TypedDeployments,
	ChainInfo,
	AugmentedChainInfo,
	DeploymentsStore,
	TypedAugmentedDeployments,
	AugmentedDeployments,
	AugmentedChain,
	BlockExplorers,
	BlockExplorerConfig,
	KnownChainProperties,
	JSONValue,
} from '$lib/deployments-store';

// Import type for local use
import type {
	TypedDeployments,
	ChainInfo,
	DeploymentsStore,
} from '$lib/deployments-store';

// ============================================================================
// Signer and Account Types
// ============================================================================

export type Signer = {
	owner: `0x${string}`;
	address: `0x${string}`;
	privateKey: `0x${string}`;
};
export type OptionalSigner = Signer | undefined;
export type OptionalSignerStore = Readable<OptionalSigner>;

export type Account = `0x${string}` | undefined;
export type AccountStore = Readable<Account>;

// ============================================================================
// Client Types
// ============================================================================

/**
 * Typed wallet client with chain info from deployments
 */
export type TypedWalletClient = WalletClient<
	CustomTransport,
	ChainInfo,
	ViemAccount | undefined
>;

/**
 * Typed public client with chain info from deployments
 */
export type TypedPublicClient = PublicClient<CustomTransport, ChainInfo>;

// ============================================================================
// Connection Types
// ============================================================================

// Derived from the actual `createChainConnection` configuration in ./remote so
// it always matches the store that is created (targetStep, walletOnly, etc.).
// Changing the config there updates this type and all consumers automatically.
export type {ChainConnection} from './remote';
import type {ChainConnection} from './remote';

/**
 * The payment rail: a wallet-only connection that never advances past
 * 'WalletConnected', plus its clients. Its own type (rather than
 * `ChainConnection`) so call sites cannot accidentally ask it for a signer or a
 * sign-in it does not have.
 */
export type {PaymentRail} from './remote';
import type {PaymentRail} from './remote';

export type EstablishedConnection = {
	connection: ChainConnection;
	walletClient: TypedWalletClient;
	publicClient: TypedPublicClient;
	account: AccountStore;
	signer: OptionalSignerStore;
	/** Second connection used only to pay, built on first use (see ./remote). */
	payment: PaymentRail;
	deployments: DeploymentsStore;
	/** Debug-only runtime flag: when set, all RPC requests fail (see rpc-fault). */
	forceRpcFailure: import('svelte/store').Writable<boolean>;
};
