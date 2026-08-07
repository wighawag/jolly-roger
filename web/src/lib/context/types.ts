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
	viewState: ViewStateStore;
	clock: Clock;
	txObserver: TransactionObserver;
	txObserverDebug: TxObserverDebugStore;
	balanceCheck: BalanceCheckStore;
};
