import type {Account, CustomTransport} from 'viem';
import type {Readable} from 'svelte/store';
import type {BalanceStore} from '$lib/core/connection/balance';
import type {GasFeeStore} from '$lib/core/connection/gasFee';
import type {RpcHealthStore} from '$lib/core/connection/rpcHealth';
import type {NonceCacheStore} from '$lib/core/connection/nonce-cache-store';
import type {OfflineStore} from '$lib/core/connection/offline';
import type {
	AccountStore,
	ChainConnection,
	ChainInfo,
	DeploymentsStore,
	TypedPublicClient,
} from '$lib/core/connection/types';
import type {ExecutorStore} from '$lib/core/connection/executor';
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
import type {InFlightLedger} from '$lib/core/transaction/in-flight-store';
import type {NavigationService} from '$lib/core/navigation';
import type {OverlayRegistry} from '$lib/core/ui/overlay';

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
	 * See ADR-0002 (`work` branch).
	 */
	fatal: Readable<string | undefined>;
	gasFee: GasFeeStore;
	/**
	 * Balance of the authenticated account: what `accountExecutor` spends.
	 *
	 * Named for whose it is rather than for the role it plays, so a call site
	 * that named the executor it sends from names the matching balance and the
	 * two cannot drift apart.
	 */
	accountBalance: BalanceStore;
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
	 * Sends from the AUTHENTICATED ACCOUNT, with a wallet prompt. Prefer it over
	 * `walletClient` for sending: it resolves the `from` address and client
	 * together, and reports when the connected account cannot send at all.
	 */
	accountExecutor: ExecutorStore;
	/** Notice shown when the connected account cannot send. */
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
	/**
	 * Transaction requests handed to the wallet whose fate the app has not seen.
	 *
	 * Recorded BEFORE dispatch and reconciled by nonce afterwards, so the window
	 * between asking a wallet to send and hearing back stops being a window in
	 * which the app believes nothing happened. Until reconciled the outcome is
	 * UNKNOWN, never failed and never rejected: the app must not record a
	 * rejection it did not observe. See ADR-0004 (`work` branch).
	 */
	inFlight: InFlightLedger;
	/**
	 * Where the app is, and the history entries it owns. Inert until the
	 * framework adapter (`$lib/kit`) attaches a driver in the browser, so this is
	 * constructible on the server like everything else here (ADR-0002).
	 */
	navigation: NavigationService;
	/**
	 * View overlays: the ones whose visibility IS their state. Closing them on a
	 * route change and giving back their history entries happens here, once, so
	 * no feature has to remember to. System overlays (visibility derived from
	 * domain state) are not registered and are deliberately untouched.
	 * See ADR-0004 (`work` branch).
	 */
	overlays: OverlayRegistry;
};
