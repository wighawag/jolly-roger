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
 *
 * Not part of {@link EstablishedConnection}: an app builds one only if it takes
 * payments (see createPaymentRail in ./remote).
 */
export type {PaymentRail} from './remote';

export type EstablishedConnection = {
	connection: ChainConnection;
	/**
	 * The chain the connection was built from, after any wallet-facing RPC
	 * override. Returned rather than kept private because an app building a
	 * second connection (a payment rail) must describe the chain to that wallet
	 * exactly as this one does.
	 */
	chainInfo: ChainInfo;
	walletClient: TypedWalletClient;
	publicClient: TypedPublicClient;
	account: AccountStore;
	signer: OptionalSignerStore;
	deployments: DeploymentsStore;
	/**
	 * WHETHER SENDING THROUGH THIS CONNECTION NEEDS A HUMAN AT A WALLET.
	 *
	 * `true` for every wallet a person installed, which is why it defaults to
	 * true and why a world that says nothing keeps the loud behaviour. `false`
	 * only for a wallet that signs without asking - an embedded world generates
	 * its own and the player never sees it - and then the app must not raise
	 * "your wallet will ask you to confirm", because nothing will.
	 *
	 * It belongs to the WORLD rather than to the app for the same reason
	 * `deployments` does: the app's question is "does this send prompt", and the
	 * answer is a property of the wallet the world brought. The parallel
	 * mechanism for a key the app holds itself is `guardDispatch`'s `prompts`
	 * option, which this feeds; see the note there on why it is recorded at
	 * dispatch time and never inferred from a count.
	 */
	walletPrompts?: boolean;
	/** Debug-only runtime flag: when set, all RPC requests fail (see rpc-fault). */
	forceRpcFailure: import('svelte/store').Writable<boolean>;
};
