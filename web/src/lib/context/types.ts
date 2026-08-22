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
	PaymentRail,
	TypedPublicClient,
} from '$lib/core/connection/types';
import type {CreditsConfig} from '$lib/core/connection/credits';
import type {ExecutorStore} from '$lib/core/connection/executor';
import type {TrackedWalletClientAutoPopulate} from '@etherkit/viem-tx-tracker';
import type {
	MultiAccountDataStore,
	TransactionMetadata,
} from '$lib/account/AccountData';
import type {OnchainStateStore} from '$lib/onchain/state';
import type {DelegationStore} from '$lib/onchain/delegation';
import type {ViewStateStore} from '$lib/view';
import type {ClockStore} from '$lib/core/clock';
import type {TransactionObserver} from '@etherkit/tx-observer';
import type {BalanceCheckStore} from '$lib/core/transaction/balance-check-store';
import type {TopUpFlow} from '$lib/ui/credits/top-up-flow';
import type {DelegationCheckStore} from '$lib/ui/delegation/delegation-check';
import type {ConfirmationStore} from '$lib/core/ui/confirm/confirmation';
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
	 * One balance per executor, named the same way, so a call site that named the
	 * executor it sends from names the matching balance and the two cannot drift.
	 */
	accountBalance: BalanceStore;
	/**
	 * Gas held by the local signer: what `signerExecutor` spends.
	 *
	 * Its own account, not a view of another. The signer pays for whatever the
	 * app does on the user's behalf and it starts empty, so this is what the
	 * credits UI reads to say the user cannot move yet. Inert with no signer.
	 */
	signerBalance: BalanceStore;
	/**
	 * How to denominate the signer's gas balance for the user, or undefined to
	 * show native currency. Set only when the chain declares both an expected
	 * worst gas price and the gas one action costs; see core/connection/credits.
	 */
	credits: CreditsConfig | undefined;
	/**
	 * The payment rail (buying credits): a second, wallet-only connection plus
	 * its clients. The payer is not necessarily the player. Dormant until
	 * something calls `ensureConnected` on it. See core/connection/remote.
	 */
	payment: PaymentRail;
	/**
	 * Funding the local signer, as a flow the user is walked through.
	 *
	 * One per app, not one per component, because two places drive it: the
	 * account panel, and the insufficient-funds modal when the signer is the
	 * account that cannot pay. Separate instances would let a second top-up start
	 * on top of one already running. See ui/credits/top-up-flow.
	 */
	topUp: TopUpFlow;
	/**
	 * Ensuring this browser may act for the account, without losing the action
	 * that discovered it could not.
	 *
	 * The counterpart of `balanceCheck` for authorisation rather than funds: the
	 * interrupted call waits on a promise while the user registers, and resumes
	 * on their say-so. See ui/delegation/delegation-check.
	 */
	delegationCheck: DelegationCheckStore;
	/**
	 * The yes/no questions the app has to ask before going on: carrying on with
	 * an interrupted action, or giving up on one a wallet may still act upon.
	 *
	 * Knows nothing about what is being asked: the caller supplies the words,
	 * this holds the promise, and one modal renders it. See core/ui/confirm.
	 */
	confirmation: ConfirmationStore;
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
	 * Sends from the AUTHENTICATED ACCOUNT, with a wallet prompt. Use it for
	 * anything only that account may do, or that moves the user's own money.
	 * Reports `cannot-send` for an account with no wallet (email/social sign-in).
	 */
	accountExecutor: ExecutorStore;
	/**
	 * Sends from the LOCAL SIGNER, silently. Use it for whatever the app does on
	 * the user's behalf. Never `ready` in an app that does not sign in, which a
	 * call site handles like any other not-ready state.
	 */
	signerExecutor: ExecutorStore;
	/**
	 * Whether this app signs in, and therefore has a local signer at all
	 * (`targetStep === 'SignedIn'`). Never test `PUBLIC_WALLET_HOST` for this: a
	 * wallet-only sign-in has no host and still derives a signer.
	 */
	hasLocalSigner: boolean;
	/** Notice shown when the connected account cannot send. */
	accountCannotSend: AccountCannotSendStore;
	/** Full transaction-error text shown on demand (the toast shows a summary). */
	errorDetails: ErrorDetailsStore;
	publicClient: TypedPublicClient;
	account: AccountStore;
	deployments: DeploymentsStore;
	accountData: MultiAccountDataStore;
	onchainState: OnchainStateStore;
	/**
	 * Whether this browser's signer may act for the account, read from the chain
	 * and kept live.
	 *
	 * The app has to know BEFORE it lets a send through, or the user gets a bare
	 * `NotDelegate` revert. Treated the way "needs funds" already is: a state the
	 * UI reads, explains, and offers the remedy for (the top-up flow, which
	 * registers and funds in one transaction). See onchain/delegation.
	 */
	delegation: DelegationStore;
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
