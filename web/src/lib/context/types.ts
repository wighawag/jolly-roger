import type {Account, CustomTransport} from 'viem';
import type {Readable} from 'svelte/store';
import type {BalanceStore} from '$lib/core/connection/balance';
import type {SignerBalanceStore} from '$lib/core/connection/signerBalance';
import type {GasFeeStore} from '$lib/core/connection/gasFee';
import type {RpcHealthStore} from '$lib/core/connection/rpcHealth';
import type {NonceCacheStore} from '$lib/core/connection/nonce-cache-store';
import type {OfflineStore} from '$lib/core/connection/offline';
import type {
	AccountStore,
	ChainConnection,
	ChainInfo,
	DeploymentsStore,
	PaymentRailProvider,
	TypedPublicClient,
} from '$lib/core/connection/types';
import type {CreditsConfig} from '$lib/core/connection/credits';
import type {ExecutorStore} from '$lib/core/connection/executor';
import type {ExecutionMode} from '$lib/core/connection/mode';
import type {TrackedWalletClientAutoPopulate} from '@etherkit/viem-tx-tracker';
import type {
	MultiAccountDataStore,
	TransactionMetadata,
} from '$lib/account/AccountData';
import type {OnchainStateStore} from '$lib/onchain/state';
import type {ViewStateStore} from '$lib/view';
import type {ClockStore} from '$lib/core/clock';
import type {TransactionObserver} from '@etherkit/tx-observer';
import type {BalanceCheckStore} from '$lib/core/transaction/balance-check-store';
import type {AccountCannotSendStore} from '$lib/core/transaction/account-cannot-send-store';
import type {ErrorDetailsStore} from '$lib/core/transaction/error-details-store';

/**
 * TrackedWalletClient with chain info from deployments.
 * This allows writeContract calls to have optional `chain` parameter
 * since the client already has a chain associated.
 */
export type WalletClient = TrackedWalletClientAutoPopulate<
	TransactionMetadata,
	CustomTransport,
	ChainInfo,
	Account | undefined
>;

export type Clock = ClockStore;

export type TxObserverDebugState = {
	processCount: number;
	lastProcessTime: number | null;
	isLeader: boolean;
};

export type TxObserverDebugStore = Readable<TxObserverDebugState>;

export type Context = {
	/**
	 * Set when the app cannot run at all, with the reason to show the user
	 * (illegal env combination, or a `?burner=true` that cannot be honoured).
	 * A store rather than a throw: construction has to succeed on the server
	 * too, and the param-derived case is only knowable in the browser. The
	 * layout renders the init-error screen whenever this holds a message.
	 * See ADR-0002.
	 */
	fatal: Readable<string | undefined>;
	gasFee: GasFeeStore;
	/** Balance of the spending address (executor: wallet/owner or local signer). */
	balance: BalanceStore;
	/**
	 * Balance of the authenticated account (wallet/owner). In wallet mode owner
	 * and spender are the same account, so this is the SAME store instance as
	 * `balance` (subscribing to both never polls twice); in signer mode it is a
	 * separate poller for the owner (while `balance` follows the signer).
	 */
	ownerBalance: BalanceStore;
	/**
	 * Balances of the LOCAL SIGNER and of its owner, polled together.
	 *
	 * `balance`/`ownerBalance` follow ROLES (who pays, who is authenticated) and
	 * so point at different addresses per execution mode; this one always points
	 * at the signer, which is the account an app spends from when it sends moves
	 * itself, and which holds nothing until someone funds it. Purely for
	 * VISIBILITY (and for offering a top-up): transaction gating stays with
	 * `balanceCheck`, which measures the executor.
	 *
	 * Inert when there is no signer: the poller is gated on the signer store, so
	 * it never fetches before sign-in, nor in wallet-only deployments.
	 */
	signerBalance: SignerBalanceStore;
	/**
	 * How to denominate the signer's gas balance for the user, or undefined to
	 * show native currency. Set only when the chain declares both an expected
	 * worst gas price and the gas one action costs; see core/connection/credits.
	 */
	credits: CreditsConfig | undefined;
	/**
	 * The payment rail (buying credits): a second, wallet-only connection plus
	 * its clients, built the FIRST time something asks for it. The payer is not
	 * necessarily the player, and a session that never pays never builds it - nor
	 * may it, while the app connection is still discovering wallets. See
	 * core/connection/remote.
	 */
	payment: PaymentRailProvider;
	rpcHealth: RpcHealthStore;
	/**
	 * Wallet nonce-cache detection (dev + app-RPC only; a no-op store otherwise).
	 * Signals when the connected wallet's cached pending nonce is AHEAD of the
	 * node, which strands transactions after a local node restart. The UI shows a
	 * banner telling the user to reset/clear the account in their wallet.
	 */
	nonceCache: NonceCacheStore;
	/** Refresh every chain read (onchain state, gas, balances) at once. */
	refreshChainData: () => void;
	/**
	 * Whether the app has an RPC of its own (PUBLIC_NODE_URL or a chain rpcUrl).
	 * When false, the app reaches the chain only through the connected wallet, so
	 * chain-data fetching waits for a wallet connection and the UI explains this
	 * instead of reporting a failing RPC.
	 */
	hasAppRpc: boolean;
	/**
	 * Whether the app can read the chain right now (has its own RPC, or the
	 * wallet is connected and supplies one). UI gates onchain fetches on this and
	 * shows a "connect to load" state instead of firing calls that would fail.
	 */
	canReadChain: Readable<boolean>;
	/**
	 * Debug-only runtime flag: setting it makes all RPC requests fail (and
	 * clearing it lets them succeed again), to exercise the RPC-health / retry UI.
	 * Reachable from the console via `context.forceRpcFailure.set(true|false)`.
	 */
	forceRpcFailure: import('svelte/store').Writable<boolean>;
	offline: OfflineStore;
	connection: ChainConnection;
	/**
	 * Tracked wallet client that wraps the underlying viem WalletClient.
	 * Supports optional `metadata` field on writeContract/sendTransaction for tracking.
	 */
	walletClient: WalletClient;
	/**
	 * Mode-agnostic transaction executor (wallet account vs local signer).
	 * Prefer this over `walletClient` for sending transactions: it resolves the
	 * correct `from` address and client, and reports when the connected account
	 * cannot send under the configured execution mode.
	 */
	executor: ExecutorStore;
	/** Configured execution mode ('wallet' or 'signer'). */
	executionMode: ExecutionMode;
	/** Notice shown when the connected account cannot send in the current mode. */
	accountCannotSend: AccountCannotSendStore;
	/** Full transaction-error text shown on demand (the toast shows a summary). */
	errorDetails: ErrorDetailsStore;
	publicClient: TypedPublicClient;
	account: AccountStore;
	deployments: DeploymentsStore;
	accountData: MultiAccountDataStore;
	onchainState: OnchainStateStore;
	viewState: ViewStateStore;
	clock: Clock;
	txObserver: TransactionObserver;
	txObserverDebug: TxObserverDebugStore;
	balanceCheck: BalanceCheckStore;
};
