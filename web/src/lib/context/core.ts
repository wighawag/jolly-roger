import type {Context, TxObserverDebugState} from './types.js';
import {writable, derived, get, type Readable} from 'svelte/store';
import {createAccountData} from '$lib/account/AccountData.js';
import type {TransactionMetadata} from '$lib/account/AccountData.js';
import {establishRemoteConnection} from '$lib/core/connection';
import {createBalanceStore} from '$lib/core/connection/balance';
import {createGasFeeStore} from '$lib/core/connection/gasFee';
import {createRpcHealthStore} from '$lib/core/connection/rpcHealth';
import {createOfflineStore} from '$lib/core/connection/offline';
import {createClockStore} from '$lib/core/clock';
import {createTransactionObserver} from '@etherkit/tx-observer';
import {createTabLeaderService} from '$lib/core/tab-leader';
import {createTrackedWalletClient} from '@etherkit/viem-tx-tracker';
import {
	createTrackedWalletConnector,
	createTransactionObserverConnector,
	createOnchainStateRefreshConnector,
} from '$lib/account/connectors.js';
import {createToastConnector} from '$lib/account/toastConnector.js';
import {initBurnerWallet} from '@etherkit/burner-wallet';
import {
	PUBLIC_NODE_URL,
	PUBLIC_CHAIN_INFO_NODE_URL,
	PUBLIC_USE_BURNER_WALLET,
	PUBLIC_WALLET_HOST,
	PUBLIC_IMPERSONATE_ADDRESSES,
} from '$env/static/public';
import {burnerOverride} from '$lib';
import {resolveBurnerWallet} from './burner.js';
import {
	resolveConnectionConfig,
	TARGET_STEP,
} from '$lib/core/connection/mode.js';
import {
	hasConfiguredRpc,
	resolveAppRpcUrl,
} from '$lib/core/connection/rpc-config.js';
import {
	createNonceCacheStore,
	inactiveNonceCacheStore,
} from '$lib/core/connection/nonce-cache-store.js';
import {createExecutor} from '$lib/core/connection/executor.js';
import {
	walletIdentityOf,
	type TxSource,
} from '$lib/core/connection/tx-source.js';
import type {SenderRegistry} from '$lib/core/connection/senders.js';
import {ensureCanSignAs} from '$lib/core/connection/ensure-can-sign.js';
import {nodeNonceReader} from '$lib/core/connection/nonce-cache.js';
import {
	createInFlightLedger,
	ephemeralStorage,
} from '$lib/core/transaction/in-flight-store.js';
import {guardDispatch} from '$lib/core/transaction/dispatch-guard.js';
import {startInFlightTracking} from '$lib/core/transaction/in-flight-tracking.js';
import {createRecordedNonceReader} from '$lib/account/recorded-nonces.js';
import {createAccountCannotSendStore} from '$lib/core/transaction/account-cannot-send-store.js';
import {createErrorDetailsStore} from '$lib/core/transaction/error-details-store.js';
import type {AugmentedChainInfo} from '$lib/core/connection/types.js';
import {createBalanceCheckStore} from '$lib/core/transaction/balance-check-store.js';
import {createNavigationService} from '$lib/core/navigation/index.js';
import {createOverlayRegistry} from '$lib/core/ui/overlay/index.js';
import {
	resolveAppConfig,
	operationScopeAddress,
	type ResolvedAppConfig,
} from './config.js';
import {startTxObserverLoop} from '$lib/core/tx-observer';
import {parseImpersonateAddresses} from '$lib/dev-accounts.js';

/**
 * What `core.ts` hands the app's half, and what it expects back.
 *
 * THIS IS WHAT CORE HAS, NOT WHAT THIS DEMO USES, and the difference is the
 * whole point. It listed the greeting demo's four needs once, and every
 * descendant then had to edit it: one had to REMOVE `maxMessages` (its
 * `config.ts` has no such field, so it was a type error rather than a
 * widening), one renamed it and added five members, one added nine. Three out
 * of three edited the block, in both directions, so it conflicted on every
 * single alignment.
 *
 * A descendant should PICK from this list, never edit it. If something core
 * builds is missing here, adding it is a one-line change that costs nothing;
 * if a member is unused by an app, ignoring it costs nothing either.
 *
 * The one genuinely per-app value is chain-derived configuration, and it is
 * passed as the WHOLE resolved object (`appConfig`) rather than as a field of
 * it. `ResolvedAppConfig` is defined in `./config.ts`, which every fork rewrites
 * anyway, so the fork changes the file it was already changing and this seam
 * stays byte-identical.
 */
export type CoreServices = {
	/** The chain connection, and how far the app has authenticated to it. */
	connection: Context['connection'];
	publicClient: Context['publicClient'];
	deployments: Context['deployments'];
	/** The authenticated account, as the connection reports it. */
	account: Context['account'];
	accountData: Context['accountData'];
	/**
	 * Sends from the authenticated account, with a wallet prompt. Prefer it over
	 * `walletClient`: it resolves the `from` address and the client together.
	 */
	accountExecutor: Context['accountExecutor'];
	/** Already guarded by the in-flight ledger, so any send records itself. */
	walletClient: Context['walletClient'];
	/** Gas held by the account that pays. */
	accountBalance: Context['accountBalance'];
	/** Whether that account can cover a given call at current gas. */
	balanceCheck: Context['balanceCheck'];
	/** Where a failed transaction's full error text goes, for the details view. */
	errorDetails: Context['errorDetails'];
	txObserver: Context['txObserver'];
	clock: Context['clock'];
	/**
	 * Chain reads only run while this is truthy, or always when it is undefined.
	 * The app must thread it into anything that polls, or its reads will run with
	 * no RPC to run against.
	 */
	chainFetchGate: Readable<boolean> | undefined;
	/** Whether the chain is readable right now, as a store the UI can gate on. */
	canReadChain: Context['canReadChain'];
	/** Whether the app has an RPC of its own, or reads only through the wallet. */
	hasAppRpc: boolean;
	/**
	 * Chain-derived configuration, exactly as `./config.ts` resolved it.
	 *
	 * The whole object rather than a chosen field, so an app that adds one reads
	 * it here without this type changing. See the note above.
	 */
	appConfig: ResolvedAppConfig;
};

/**
 * What the app's half contributes to the context.
 *
 * SPREAD into the context literal as-is, which is the point: an app that adds
 * members of its own returns them here and never edits this file. Two
 * descendants already need that (`mandalas` adds a purchase flow,
 * `template-commit-reveal` adds the game and its renderer), and under the old
 * single-function context each of them had to insert into the middle of the
 * literal, which is where several of the recorded conflicts landed.
 *
 * The two named members are the ones CORE consumes: `onchainState` feeds the
 * refresh connector, the RPC-health inputs and `refreshChainData`. Anything
 * beyond them core neither sees nor cares about.
 */
export type AppContext = {
	onchainState: Context['onchainState'];
	viewState: Context['viewState'];
	/**
	 * The app's own IO, begun when the context starts and torn down with it.
	 * Returns its teardown, like every other `start` here.
	 *
	 * Optional because this app has none: its chain reads are driven by core's
	 * refresh wiring. An app with a loop of its own (a game stepping epochs, a
	 * feed polling) needs somewhere to put it that is not core, and without this
	 * it would have to reach into core's lifecycle to get it.
	 */
	start?: () => () => void;
};

/**
 * Generic over the app's own shape, so a descendant returning MORE than
 * `AppContext` keeps those extra members typed all the way into the context
 * rather than having them widened away at the seam.
 */
export type AppFactory<App extends AppContext = AppContext> = (
	core: CoreServices,
) => App;

/**
 * THE COMPOSITION IS A SEQUENCE OF BUILDERS, AND EACH ONE NAMES WHAT IT NEEDS.
 *
 * This used to be one 570-line function. The problem was never its length: it
 * was that the ORDER was load-bearing and invisible. Blocks had to sit above or
 * below the app half depending on what they consumed, that constraint lived
 * only in prose, and a merge that reordered them compiled perfectly and broke at
 * runtime. One did: `a41dcb8` took main's reordering and had to place this
 * branch's blocks against it by reading every comment in the file.
 *
 * Each builder below takes what it consumes as parameters, so the order is now
 * checked. Move a call above something it needs and it is a type error at the
 * call site, in this file, rather than an `undefined` capture discovered later.
 *
 * WHAT A DESCENDANT DOES: adds a builder of its own and one call, instead of
 * inserting into the middle of a long sequence. `with/local-signer` adds five
 * members this way (signerAddress, delegation, confirmation, topUp,
 * delegationCheck) and its diff against this file becomes additive.
 */

/** The chain connection. Needs only configuration, so it is first. */
function buildConnection(params: {
	targetStep: ReturnType<typeof resolveConnectionConfig>['targetStep'];
	walletHost: ReturnType<typeof resolveConnectionConfig>['walletHost'];
	walletOnly: ReturnType<typeof resolveConnectionConfig>['walletOnly'];
}) {
	const {targetStep, walletHost, walletOnly} = params;

	const {
		connection,
		walletClient: rawWalletClient,
		publicClient,
		account,
		deployments,
		forceRpcFailure,
	} = establishRemoteConnection({
		nodeURL: PUBLIC_NODE_URL,
		targetStep,
		walletHost,
		walletOnly,
		// The RPC url handed to the WALLET, which is not necessarily the one the
		// app uses. Without it the exported chain info carries an empty rpc list
		// (rocketh does not bake a public endpoint into chain info), and a wallet
		// that does not already know the chain cannot be told how to reach it:
		// wallet_switchEthereumChain fails with "Unrecognized chain ID" and there
		// is nothing to fall back to wallet_addEthereumChain with.
		//
		// Deliberately NOT defaulted to PUBLIC_NODE_URL: that one may be a private
		// or key-bearing endpoint, and this value is handed to every user's wallet.
		chainInfoNodeURL: PUBLIC_CHAIN_INFO_NODE_URL,
	});

	return {
		connection,
		rawWalletClient,
		publicClient,
		account,
		deployments,
		forceRpcFailure,
	};
}

/** Chain-derived configuration, the clock, and per-account storage. */
function buildChainConfig(params: {
	deployments: ReturnType<typeof buildConnection>['deployments'];
	connection: ReturnType<typeof buildConnection>['connection'];
	account: ReturnType<typeof buildConnection>['account'];
}) {
	const {deployments, connection, account} = params;

	// ----------------------------------------------------------------------------
	// CHAIN CONFIGURATION
	// ----------------------------------------------------------------------------

	// Resolve chain-specific configuration (finality, block time, intervals)
	// from the chain's optional properties + defaults.
	//
	// Kept WHOLE as well as destructured: core uses two of its fields, and the
	// app's half is handed the entire object (see CoreServices), so a fork that
	// adds a field to `config.ts` reads it without touching this file.
	const chain = deployments.get().chain as AugmentedChainInfo;
	const appConfig = resolveAppConfig(chain);
	const {finality, txObserverProcessInterval} = appConfig;

	// The app's own RPC url, when it has one. Only the nonce-cache check below
	// needs it, to compare the wallet's idea of the nonce against a trusted node.
	const appRpcUrl = resolveAppRpcUrl(
		PUBLIC_NODE_URL,
		chain.rpcUrls?.default?.http,
	);

	// Whether the app has an RPC of its own (PUBLIC_NODE_URL or a chain rpcUrl).
	// When it does not, the app can only reach the chain via the connected wallet,
	// so chain-data fetching must wait until the wallet is connected (otherwise it
	// would fail and look like a broken RPC). Exposed so the UI can explain this.
	const hasAppRpc = hasConfiguredRpc(
		PUBLIC_NODE_URL,
		chain.rpcUrls?.default?.http,
	);

	// Whether the app can read the chain right now: it has its own RPC, or the
	// wallet is connected (and supplies one). Always a boolean, so UI can gate
	// fetches and show a "connect to load" state instead of firing calls that
	// would fail and look like a broken RPC. See also chainFetchGate below.
	const canReadChain = derived(
		connection,
		($c) => hasAppRpc || connection.isTargetStepReached($c),
	);

	// Gate for chain reads (onchain state, gas). With an app RPC, fetch
	// unconditionally. Without one, only fetch once the wallet is connected (its
	// provider then supplies the RPC), so we do not fire calls that would fail and
	// look like a broken RPC while disconnected.
	const chainFetchGate = hasAppRpc ? undefined : canReadChain;

	// Reactive clock store that updates every second for smooth "time ago" displays
	const clock = createClockStore();

	// Built here rather than further down, because the in-flight ledger below
	// reconciles against the operations it holds, and the wallet client is guarded
	// by that ledger. Ordering the three by what they need keeps every reference
	// forward-free.
	const accountData = createAccountData({
		accountStore: account,
		deployments: deployments.get(),
		clock,
		scopeAddress: operationScopeAddress(deployments.get()),
	});

	return {
		chain,
		appConfig,
		finality,
		txObserverProcessInterval,
		appRpcUrl,
		hasAppRpc,
		canReadChain,
		chainFetchGate,
		clock,
		accountData,
	};
}

/** The durable record of sends the app has not seen the fate of. */
function buildInFlight(params: {
	chain: ReturnType<typeof buildChainConfig>['chain'];
	clock: ReturnType<typeof buildChainConfig>['clock'];
	appRpcUrl: ReturnType<typeof buildChainConfig>['appRpcUrl'];
	accountData: ReturnType<typeof buildChainConfig>['accountData'];
	publicClient: ReturnType<typeof buildConnection>['publicClient'];
	account: ReturnType<typeof buildConnection>['account'];
	deployments: ReturnType<typeof buildConnection>['deployments'];
}) {
	const {
		chain,
		clock,
		appRpcUrl,
		accountData,
		publicClient,
		account,
		deployments,
	} = params;

	// ----------------------------------------------------------------------------
	// IN-FLIGHT TRANSACTION REQUESTS
	// ----------------------------------------------------------------------------

	// Durable records of transactions handed to the wallet whose fate the app has
	// not seen. See core/transaction/in-flight: an operation is otherwise recorded
	// only on `transaction:broadcasted`, so a reload between dispatching
	// eth_sendTransaction and receiving the hash leaves the app believing nothing
	// happened while it may already be in the mempool. ADR-0004 (`work` branch).
	const inFlight = createInFlightLedger({
		// No storage off-browser, and nothing to record there either: the context is
		// constructed during SSR / prerender too (ADR-0002). A ledger over a
		// throwaway Map is inert rather than absent, so nothing has to null-check it.
		storage:
			typeof localStorage !== 'undefined' ? localStorage : ephemeralStorage(),
		chainId: chain.id,
		// A chain id is not identity: a restarted dev node returns as the same id
		// with a different history, and these records are reconciled BY NONCE.
		// AccountData's own key has always been scoped this way.
		genesisHash: chain.genesisHash,
		now: () => clock.now(),
		// The app's own RPC when it has one, and the wallet's provider otherwise.
		// The order is deliberate: `nonce-cache.ts` documents at length that a
		// wallet's own nonce is exactly what cannot be trusted here.
		readNodeNonce: appRpcUrl
			? (address) => nodeNonceReader(appRpcUrl, address)()
			: async (address) => {
					try {
						return await publicClient.getTransactionCount({
							address,
							blockTag: 'pending',
						});
					} catch {
						return undefined;
					}
				},
		recordedNonces: createRecordedNonceReader({
			accountData,
			account,
			// So a record can be reconciled against the account IT names, rather
			// than only the one that happens to be connected. On a reload with a
			// locked wallet there is no connected account at all, which is exactly
			// when this has to work.
			deployments: deployments.get(),
			scopeAddress: operationScopeAddress(deployments.get()),
		}),
	});

	return {inFlight};
}

/** The tracked, dispatch-guarded wallet client. AFTER the ledger it guards. */
function buildWalletClient(params: {
	clock: ReturnType<typeof buildChainConfig>['clock'];
	connection: ReturnType<typeof buildConnection>['connection'];
	rawWalletClient: ReturnType<typeof buildConnection>['rawWalletClient'];
	publicClient: ReturnType<typeof buildConnection>['publicClient'];
	inFlight: ReturnType<typeof buildInFlight>['inFlight'];
}) {
	const {clock, connection, rawWalletClient, publicClient, inFlight} = params;

	// ----------------------------------------------------------------------------
	// TRACKED WALLET CLIENT
	// ----------------------------------------------------------------------------

	// Wrap the raw wallet client with tracking capabilities
	// This is exposed as `walletClient` for drop-in compatibility
	// Use `walletClient.walletClient` to access the underlying viem WalletClient if needed
	// A THUNK, NOT A VALUE, and read at each broadcast rather than here. This
	// client is built once and lives for the session, while the wallet behind it
	// does not: the user can connect a different one, or switch account inside
	// the one they have, between now and any given send. A source captured at
	// construction would name the wallet that happened to be connected at page
	// load, which is precisely the transaction-to-wallet mapping this exists to
	// get right. See core/connection/tx-source.
	const trackerBuilder = createTrackedWalletClient<
		TransactionMetadata,
		TxSource
	>({
		populateMetadata: true,
		clock: () => clock.now(),
		source: () => ({
			route: 'account',
			wallet: walletIdentityOf(get(connection)),
		}),
	});
	// GUARDED HERE, ONCE, so every send in the app records itself before dispatch:
	// the account executor below is handed this client, and so is anything using
	// `context.walletClient` directly. An app that builds a SECOND tracked client
	// (a local signer, see executor.ts's buildSignerClient) has to guard that one
	// too; nothing can do it on its behalf, and it should pass `{prompts: false}`
	// because a key the app holds sends with no dialog and nobody to instruct.
	//
	// This one prompts, which is the default, so it says nothing: sends here go to
	// a wallet the user has to answer.
	const walletClient = guardDispatch(
		trackerBuilder.using(rawWalletClient, publicClient),
		inFlight,
	);

	return {walletClient};
}

/** Who signs, what watches the result, and the connectors that file it. */
function buildExecution(params: {
	connection: ReturnType<typeof buildConnection>['connection'];
	walletClient: ReturnType<typeof buildWalletClient>['walletClient'];
	accountData: ReturnType<typeof buildChainConfig>['accountData'];
	finality: ReturnType<typeof buildChainConfig>['finality'];
	inFlight: ReturnType<typeof buildInFlight>['inFlight'];
}) {
	const {connection, walletClient, accountData, finality, inFlight} = params;

	// ----------------------------------------------------------------------------
	// TRANSACTION EXECUTOR
	// ----------------------------------------------------------------------------
	// Named for WHOSE KEY SIGNS. Call sites use this instead of the wallet client
	// plus account address, so the `from` address, the account argument and the
	// client can never disagree about who is paying.
	//
	// One executor here, because this app authenticates only as far as a
	// connected wallet (see TARGET_STEP in core/connection/mode) and so has no
	// local signer to offer a second one. An app that flips that switch adds a
	// `sendFrom: 'signer'` executor beside this one, supplying the client factory
	// that mode requires; nothing about this one changes.
	const accountExecutor = createExecutor({
		connection,
		walletClient,
		sendFrom: 'account',
	});

	const accountCannotSend = createAccountCannotSendStore();
	const errorDetails = createErrorDetailsStore();

	// The address that actually pays. Balance checks and the top-bar balance
	// follow it, so a shown or gating balance always belongs to the account that
	// would be spending.
	const accountAddress = derived(accountExecutor, ($executor) =>
		$executor.status === 'ready' ? $executor.address : undefined,
	);

	// ----------------------------------------------------------------------------

	const txObserver = createTransactionObserver({
		finality,
		provider: connection.provider,
		// Injected wallets (e.g. MetaMask) can keep serving a stale pending view
		// from eth_getTransactionByHash (blockNumber null) for an already-mined
		// tx, while eth_getTransactionReceipt returns the real receipt. Fetch the
		// receipt directly in that case so inclusion is detected through the
		// user's own wallet-configured node (no dedicated/hardcoded RPC needed).
		alwaysFetchReceipt: true,
	});

	const tabLeader = createTabLeaderService();

	const trackedWalletConnector = createTrackedWalletConnector({
		walletClient,
		accountData,
		// A transaction that was broadcast but could not be filed as an operation
		// (the account went away between dispatch and answer) goes to the ledger,
		// which already holds a record for it and can now attach the hash. Without
		// this the app has a transaction on chain and no note of it anywhere, which
		// is the outcome the whole in-flight machinery exists to prevent.
		onUnrecordedBroadcast: ({from, nonce, hash}) =>
			inFlight.noteUnrecordedBroadcast({account: from, nonce, hash}),
	});

	const txObserverConnector = createTransactionObserverConnector({
		accountData,
		txObserver,
	});

	return {
		accountExecutor,
		accountCannotSend,
		errorDetails,
		accountAddress,
		txObserver,
		tabLeader,
		trackedWalletConnector,
		txObserverConnector,
	};
}

/** Navigation, the overlay registry that follows it, and the toast connector. */
function buildNavigation(params: {
	accountData: ReturnType<typeof buildChainConfig>['accountData'];
}) {
	const {accountData} = params;

	// ----------------------------------------------------------------------------
	// NAVIGATION AND OVERLAYS
	// ----------------------------------------------------------------------------

	// Inert until `$lib/kit` attaches a driver in the browser, so both are
	// constructible on the server (ADR-0002). The registry follows the service, so
	// closing view overlays on a route change is decided in one place rather than
	// by each feature. See ADR-0004 (`work` branch).
	const navigation = createNavigationService();
	const overlays = createOverlayRegistry(navigation);

	const toastConnector = createToastConnector({
		accountData,
		overlays,
	});

	return {navigation, overlays, toastConnector};
}

/** What the paying account holds, what a call costs, and whether it can pay. */
function buildBalances(params: {
	publicClient: ReturnType<typeof buildConnection>['publicClient'];
	accountAddress: ReturnType<typeof buildExecution>['accountAddress'];
	chainFetchGate: ReturnType<typeof buildChainConfig>['chainFetchGate'];
}) {
	const {publicClient, accountAddress, chainFetchGate} = params;

	// ----------------------------------------------------------------------------
	// BALANCE AND COSTS
	// ----------------------------------------------------------------------------

	// Balance of the account that pays. One account sends everything here, so
	// there is one balance, and it is named for whose it is rather than for the
	// role it plays.
	const accountBalance = createBalanceStore({
		publicClient,
		account: accountAddress,
	});

	const gasFee = createGasFeeStore({
		publicClient: publicClient,
		fetchGate: chainFetchGate,
	});

	// No balance here: which account pays is now decided per call, not once at
	// construction. This app has exactly one payer, so every call site passes the
	// same pair, but passing it is what keeps the check and the sender from ever
	// disagreeing about whose funds were measured.
	const balanceCheck = createBalanceCheckStore({
		publicClient,
		gasFee,
	});

	const offline = createOfflineStore();

	// Debug store for tx-observer processing stats
	const txObserverDebug = writable<TxObserverDebugState>({
		processCount: 0,
		lastProcessTime: null,
		isLeader: false,
	});

	return {accountBalance, gasFee, balanceCheck, offline, txObserverDebug};
}

/**
 * Build the app context.
 *
 * Synchronous, and constructible off-browser: every service it composes idles
 * when browser APIs are absent, so this also runs during SSR and prerendering.
 * Nothing here starts IO; that belongs to `start()`, which the provider calls
 * from `onMount`. Readiness is expressed as store state, never as an
 * unresolved promise. See ADR-0002 (`work` branch).
 */
export function createCoreContext<App extends AppContext>(params: {
	createApp: AppFactory<App>;
}): {
	context: Context;
	start: () => () => void;
} {
	const {createApp} = params;
	let cleanupBurnerWallet: (() => void) | undefined;

	// Reasons the app cannot run. Collected rather than thrown: the context is
	// also constructed during SSR / prerender, where a throw would fail the build
	// instead of showing the user anything. See ADR-0002.
	const fatal = writable<string | undefined>(undefined);

	const burner = resolveBurnerWallet(
		burnerOverride,
		PUBLIC_USE_BURNER_WALLET,
		PUBLIC_NODE_URL,
	);
	// An explicit `?burner=true` that cannot be honoured is an error rather than
	// being silently ignored. It is raised in start() rather than here: it comes
	// from the URL, which is empty on the server, so setting it now would make
	// the browser's first render disagree with the prerendered HTML.
	const burnerFatal =
		burner.use === false && burner.error ? burner.error : undefined;
	// Browser-only: the burner announces itself over EIP-6963 on `window`. The
	// context is also constructed during SSR / prerender, where there is no
	// wallet to announce to. See ADR-0002.
	if (burner.use && typeof window !== 'undefined') {
		const impersonateAddresses = parseImpersonateAddresses(
			PUBLIC_IMPERSONATE_ADDRESSES,
			{
				onDropped: (entry) => {
					if (!import.meta.env.DEV) return;
					console.warn(
						`[burner] ignoring "${entry}" in PUBLIC_IMPERSONATE_ADDRESSES: ` +
							`it is not an address. The account picker will be one short.`,
					);
				},
			},
		);
		if (import.meta.env.DEV && impersonateAddresses.length === 0) {
			// Not fatal: the burner still announces itself and can hold its own
			// generated account. But asking for a burner wallet and giving it nobody
			// to impersonate is almost always a missing env var rather than intent,
			// and the symptom (an account picker with nothing familiar in it) does
			// not point at the cause.
			console.warn(
				'[burner] PUBLIC_USE_BURNER_WALLET is set but ' +
					'PUBLIC_IMPERSONATE_ADDRESSES is empty, so there is nobody to ' +
					'impersonate. See web/.env.localhost.',
			);
		}
		const {cleanup} = initBurnerWallet({
			nodeURL: burner.nodeURL,
			impersonateAddresses: [...impersonateAddresses],
		});
		cleanupBurnerWallet = cleanup;
	}

	// How the app authenticates. `targetStep` is config (see core/connection/mode);
	// only the hosted-mechanism host comes from env. Total, so nothing here can
	// fail: there is no illegal combination left to reject.
	const {targetStep, walletHost, walletOnly} = resolveConnectionConfig(
		TARGET_STEP,
		PUBLIC_WALLET_HOST,
	);

	// ----------------------------------------------------------------------------
	// CONNECTION
	// ----------------------------------------------------------------------------

	// THE ORDER BELOW IS THE DEPENDENCY ORDER, and it is now checked rather than
	// described: each call takes what it needs from the ones above it, so moving
	// one is a type error here instead of an undefined capture at runtime.
	const {
		connection,
		rawWalletClient,
		publicClient,
		account,
		deployments,
		forceRpcFailure,
	} = buildConnection({targetStep, walletHost, walletOnly});

	const {
		chain,
		appConfig,
		finality,
		txObserverProcessInterval,
		appRpcUrl,
		hasAppRpc,
		canReadChain,
		chainFetchGate,
		clock,
		accountData,
	} = buildChainConfig({deployments, connection, account});

	const {inFlight} = buildInFlight({
		chain,
		clock,
		appRpcUrl,
		accountData,
		publicClient,
		account,
		deployments,
	});

	const {walletClient} = buildWalletClient({
		clock,
		connection,
		rawWalletClient,
		publicClient,
		inFlight,
	});

	const {
		accountExecutor,
		accountCannotSend,
		errorDetails,
		accountAddress,
		txObserver,
		tabLeader,
		trackedWalletConnector,
		txObserverConnector,
	} = buildExecution({
		connection,
		walletClient,
		accountData,
		finality,
		inFlight,
	});

	const {navigation, overlays, toastConnector} = buildNavigation({accountData});

	const {accountBalance, gasFee, balanceCheck, offline, txObserverDebug} =
		buildBalances({publicClient, accountAddress, chainFetchGate});

	// EVERY ROUTE THIS APP CAN SEND FROM. One here, because this app has one; a
	// variant that adds a local signer or a payment rail registers those too, and
	// a route that can send but is not registered can never replace its own stuck
	// transactions. See core/connection/senders.
	const senders: SenderRegistry = [
		{
			route: 'account',
			executor: accountExecutor,
			balance: accountBalance,
			// `remember: true`: this is the user's own wallet, and the app connection
			// auto-connects to whichever it saw last. Recovering it must leave that
			// intact, or unsticking one transaction costs them the remembered wallet.
			// A payment rail, whose payer is chosen per purchase, passes false.
			ensureCanSign: (target) =>
				ensureCanSignAs(connection, target, {remember: true}),
		},
	];

	// ----------------------------------------------------------------------------
	// THE APP'S OWN HALF
	// ----------------------------------------------------------------------------

	// BUILT HERE, PARTWAY THROUGH, and the position is the whole design.
	//
	// Everything above is true of any app built on this template, and everything
	// the app itself composes (its chain reads, its view model) lives in `./app.ts`
	// and is replaced by a fork. Core builds it rather than the reverse because the
	// dependencies run BOTH ways and only this order resolves them: the app needs
	// the connection, the executor, the balances and the safety checks, which all
	// exist by now, and core's refresh connector, RPC-health inputs and
	// `refreshChainData` below all need the app's `onchainState`.
	//
	// THE LINE IS DRAWN AT `onchainState`, deliberately, and that is the ONLY
	// reason anything is left below. Everything that does not need the app's chain
	// reads was moved above this point, so `CoreServices` can offer it: an app that
	// needs a balance or a balance check at CONSTRUCTION (a purchase flow, a game
	// crediting a signer) would otherwise have to reorder this file, which two
	// descendants independently did before this moved.
	//
	// Injected as a factory rather than imported, so this file names no app
	// module and a descendant swaps its half by passing a different one.
	const app = createApp({
		connection,
		publicClient,
		deployments,
		account,
		accountData,
		accountExecutor,
		walletClient,
		accountBalance,
		balanceCheck,
		errorDetails,
		txObserver,
		clock,
		chainFetchGate,
		canReadChain,
		hasAppRpc,
		appConfig,
	});
	// Core consumes exactly this one by name, and `start` is lifecycle rather
	// than context, so it is held back from the spread below. The rest goes into
	// the context without this file needing to know what it is.
	const {onchainState, start: startApp, ...appContext} = app;

	const onchainStateRefreshConnector = createOnchainStateRefreshConnector({
		txObserver,
		onchainState,
	});

	// Health reflects whether we can read the chain right now. All inputs share
	// one transport, so any recent success (e.g. the 5s onchain-state poll, or a
	// user Retry) means the RPC is up and clears the banner, without waiting for
	// the slow gas poller to retry.
	const rpcHealth = createRpcHealthStore({
		inputs: [accountBalance, gasFee, onchainState],
	});

	// Wallet nonce-cache detection. Only meaningful when the app has its OWN
	// trusted node RPC to compare the wallet against, and only worth the extra
	// per-connect RPC calls in DEV (where restarting a local node desyncs the
	// wallet's cached nonce and silently strands transactions). In production, or
	// with no app RPC, we use the no-op store so nothing runs. `appRpcUrl` is the
	// same resolved app RPC (PUBLIC_NODE_URL or chain rpcUrl) that hasAppRpc
	// reflects; when hasAppRpc is true it is defined.
	const nonceCache =
		typeof window !== 'undefined' &&
		import.meta.env.DEV &&
		hasAppRpc &&
		appRpcUrl
			? createNonceCacheStore({
					connection,
					account,
					txObserver,
					nodeRpcUrl: appRpcUrl,
				})
			: inactiveNonceCacheStore;

	// Refresh every chain read at once. Used by Retry actions and the health
	// banner so a single click heals the whole health picture, not just one store.
	const refreshChainData = () => {
		void onchainState.update();
		void gasFee.update();
		void accountBalance.update();
	};

	const context: Context = {
		fatal: {subscribe: fatal.subscribe},
		gasFee,
		accountBalance,
		rpcHealth,
		nonceCache,
		refreshChainData,
		hasAppRpc,
		canReadChain,
		forceRpcFailure,
		offline,
		connection,
		walletClient,
		accountExecutor,
		senders,
		accountCannotSend,
		errorDetails,
		publicClient,
		account,
		deployments,
		accountData,
		clock,
		txObserver,
		txObserverDebug: {subscribe: txObserverDebug.subscribe},
		balanceCheck,
		inFlight,
		navigation,
		overlays,
		// The app's half, spread so a descendant adding members never edits this
		// literal. See AppContext.
		...appContext,
		onchainState,
	};

	// Dev/debug: expose the whole context on globalThis for console access
	// (e.g. `context.balance`). Self-maintaining: new context members appear
	// automatically. Delete this line if you don't want it.
	if (typeof window !== 'undefined') {
		// Guarded: this runs during context construction, so a global that refuses
		// assignment (an accessor with no setter, which is how two wallet
		// extensions fail over `window.ethereum`) would throw here and take the
		// whole app down for the sake of a console convenience.
		try {
			(globalThis as any).context = context;
		} catch {
			// Nothing to do: the app runs fine without the console handle.
		}
	}

	return {
		context,
		start: () => {
			// Raised here, not at construction: it is derived from the URL, which
			// only exists in the browser. Doing it on mount keeps the first client
			// render identical to the prerendered HTML.
			if (burnerFatal) fatal.set(burnerFatal);

			// we trigger it so it is always availabe
			const unsubscribeFromBalance = accountBalance.subscribe(() => {});
			// we trigger it so it is always availabe
			const unsubscribeFromGasFee = gasFee.subscribe(() => {});

			tabLeader.start();

			const stopTxObserverLoop = startTxObserverLoop({
				tabLeader,
				txObserver,
				intervalMs: txObserverProcessInterval,
				// App concern: record debug stats. The core loop stays free of any
				// app-specific state shape.
				onProcess: () =>
					txObserverDebug.update((state) => ({
						...state,
						processCount: state.processCount + 1,
						lastProcessTime: Date.now(),
					})),
				onLeadershipChange: (isLeader) =>
					txObserverDebug.update((state) => ({...state, isLeader})),
			});

			trackedWalletConnector.connect();
			txObserverConnector.connect();
			toastConnector.connect();
			onchainStateRefreshConnector.connect();

			// Records, reconciliation, the watcher and the unload guard, started as
			// one thing. See startInFlightTracking for why those four belong
			// together and why the guard is registered from domain state.
			const stopInFlightTracking = startInFlightTracking({
				ledger: inFlight,
				account,
				navigation,
			});

			// SAY SO IF NOBODY EVER ATTACHED A DRIVER.
			//
			// The navigation service is inert without one and every call is a no-op,
			// which is right on the server and a silent catastrophe in a browser: no
			// URL updates, no history entries, no back-closes-the-overlay, no unload
			// guard. Nothing looks broken, because prompt overlays keep working. This
			// warning is checked from the SERVICE rather than the adapter component,
			// so it also covers the case where that component never mounted at all,
			// which is the one its own fallback cannot catch.
			const attachCheck =
				import.meta.env.DEV && typeof window !== 'undefined'
					? setTimeout(() => {
							if (navigation.current()) return;
							console.warn(
								'[navigation] no driver is attached, so the app does not know ' +
									'where it is: overlay URLs, the back gesture and the unload ' +
									'guard are all inert. Is <KitNavigation /> mounted? See ' +
									'src/lib/kit/README.md, and appNavigation.attached() in the ' +
									'console.',
							);
						}, 5_000)
					: undefined;

			// Last, so the app can rely on everything core started above, and torn
			// down first below for the same reason.
			const stopApp = startApp?.();

			return () => {
				stopApp?.();
				cleanupBurnerWallet?.();
				trackedWalletConnector.disconnect();
				txObserverConnector.disconnect();
				toastConnector.disconnect();
				onchainStateRefreshConnector.disconnect();
				stopTxObserverLoop();
				stopInFlightTracking();
				if (attachCheck !== undefined) clearTimeout(attachCheck);
				overlays.stop();
				navigation.stop();
				tabLeader.stop();
				unsubscribeFromBalance();
				unsubscribeFromGasFee();
			};
		},
	};
}
