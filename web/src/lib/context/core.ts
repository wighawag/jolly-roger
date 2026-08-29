import type {Context, TxObserverDebugState} from './types.js';
// The same store the connection hands back below, imported here because the
// permission the app declares has to be known BEFORE the connection is built.
// Aliased so the name the rest of this function uses keeps coming from the
// connection, which is where every other consumer gets it.
import {deployments as deploymentsStore} from '$lib/deployments-store';
import {createWalletClient, custom, http} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {writable, derived, type Readable, type Writable} from 'svelte/store';
import {createAccountData} from '$lib/account/AccountData.js';
import {establishRemoteConnection} from '$lib/core/connection';
import {
	createPaymentRail,
	type PaymentRail,
} from '$lib/core/connection/remote.js';
import {createBalanceStore} from '$lib/core/connection/balance';
import {createGasFeeStore} from '$lib/core/connection/gasFee';
import {createRpcHealthStore} from '$lib/core/connection/rpcHealth';
import {createOfflineStore} from '$lib/core/connection/offline';
import {createClockStore} from '$lib/core/clock';
import {createDelegationState} from '$lib/onchain/delegation.js';
import {createDelegationCheckStore} from '$lib/ui/delegation/delegation-check.js';
import {createConfirmation} from '$lib/core/ui/confirm/confirmation.js';
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
	PUBLIC_FAUCET_LINK,
	PUBLIC_FAUCET_API,
} from '$env/static/public';
import {hasFaucet} from '$lib/core/ui/faucet/index.js';
import {createTopUpFlow} from '$lib/ui/credits/top-up-flow.js';
import type {SignerGrant} from '$lib/ui/delegation/grant.js';
import {burnerOverride} from '$lib';
import {resolveBurnerWallet} from './burner.js';
import {
	resolveConnectionConfig,
	TARGET_STEP,
} from '$lib/core/connection/mode.js';
import {resolveSignerRpc} from '$lib/core/connection/signer-rpc.js';
import {resolveAppRpcUrl} from '$lib/core/connection/rpc-config.js';
import {
	createNonceCacheStore,
	inactiveNonceCacheStore,
} from '$lib/core/connection/nonce-cache-store.js';
import {
	createExecutor,
	memoiseSignerClient,
	type ExecutorStore,
} from '$lib/core/connection/executor.js';
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
	delegationRegistryAddress,
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

	/**
	 * Whether this app has a local signer at all.
	 *
	 * The one predicate everything downstream uses. Deliberately NOT "is
	 * PUBLIC_WALLET_HOST set": a wallet-only sign-in has no host and still
	 * derives a signer, so testing the host would get it wrong.
	 */
	const hasLocalSigner = targetStep === 'SignedIn';

	// ----------------------------------------------------------------------------
	// CONNECTION
	// ----------------------------------------------------------------------------

	const {
		connection,
		signer,
		chainInfo,
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
		// WHAT THIS APP ASKS FOR, declared where the user can still say no: the
		// authority to act in their name at one contract on one chain, and nowhere
		// else. The pair is the same one the chain read and every writer use, from
		// the same place (see context/config's delegationRegistryAddress).
		//
		// OPTIONAL, deliberately. Required would make a refusal a wall at the door
		// for something the user cannot evaluate yet; optional keeps the app
		// browsable read-only and turns a refusal into a remedy the app offers at
		// the moment it actually needs the authorisation (see the `re-authorise`
		// route in ui/delegation/registration). A game that genuinely cannot
		// function read-only is the case for setting `required: true`.
		permissions: [
			{
				type: 'delegation',
				required: false,
				chainId: deploymentsStore.get().chain.id,
				contract: delegationRegistryAddress(deploymentsStore.get()),
			},
		],
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

	// The payment rail: a SECOND connection, used only to buy credits, built here
	// rather than by establishRemoteConnection because wanting one is this app's
	// decision and not a property of how it authenticates. A variant that sells
	// nothing simply never calls this and never pays for the second connection.
	//
	// Given the same chainInfo the app connection was built from, so the payer's
	// wallet is told about the chain exactly as the player's was, including the
	// wallet-facing RPC override.
	const rawPayment = createPaymentRail(chainInfo, {nodeURL: PUBLIC_NODE_URL});

	return {
		connection,
		signer,
		chainInfo,
		rawPayment,
		hasLocalSigner,
		rawWalletClient,
		publicClient,
		account,
		deployments,
		forceRpcFailure,
	};
}

/** Chain-derived configuration, the clock, and per-account storage. */
function buildChainConfig(params: {
	targetStep: Parameters<typeof buildConnection>[0]['targetStep'];
	walletOnly: Parameters<typeof buildConnection>[0]['walletOnly'];
	fatal: Writable<string | undefined>;
	deployments: ReturnType<typeof buildConnection>['deployments'];
	connection: ReturnType<typeof buildConnection>['connection'];
	account: ReturnType<typeof buildConnection>['account'];
}) {
	const {deployments, connection, account, targetStep, walletOnly, fatal} =
		params;

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
	// `credits` is this branch's: the top-up flow prices them. `maxMessages` is
	// no longer pulled apart here, because the app's half is handed the whole
	// resolved object (see CoreServices).
	const {finality, txObserverProcessInterval, credits} = appConfig;

	// The app's own RPC url, when it has one. Only the nonce-cache check below
	// needs it, to compare the wallet's idea of the nonce against a trusted node.
	// A local signer broadcasts raw transactions. It prefers a real node RPC
	// (PUBLIC_NODE_URL or an rpcUrl configured on the chain), and REQUIRES one
	// under hosted sign-in, where the account may have no wallet to fall back to.
	// Missing is recorded as fatal and surfaced by the init-error screen; the
	// resolved url also drives the signer client's transport below.
	const signerRpc = resolveSignerRpc(
		{targetStep, walletOnly},
		PUBLIC_NODE_URL,
		chain.rpcUrls?.default?.http,
		import.meta.env.DEV,
	);
	if (!signerRpc.ok) {
		fatal.set(signerRpc.error);
	}
	const signerRpcUrl = signerRpc.ok ? signerRpc.rpcUrl : undefined;

	// The app's own RPC url, when it has one. The nonce-cache check and the
	// in-flight ledger both need the url rather than the yes/no, to compare an
	// account's nonce against a node the app trusts.
	//
	// NOT `signerRpcUrl` above, even though today they resolve to the same string.
	// That one answers "where does the local signer BROADCAST", and it is
	// deliberately undefined when the resolution failed; this one answers "which
	// node does the app read from". Collapsing them would tie a read the ledger
	// depends on to a fatal condition about sending.
	const appRpcUrl = resolveAppRpcUrl(
		PUBLIC_NODE_URL,
		chain.rpcUrls?.default?.http,
	);

	// Whether the app has an RPC of its own (PUBLIC_NODE_URL or a chain rpcUrl).
	// When it does not, the app can only reach the chain via the connected wallet,
	// so chain-data fetching must wait until the wallet is connected (otherwise it
	// would fail and look like a broken RPC). Exposed so the UI can explain this.
	const hasAppRpc = !!appRpcUrl;

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
		credits,
		signerRpcUrl,
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
	rawPayment: ReturnType<typeof buildConnection>['rawPayment'];
	clock: ReturnType<typeof buildChainConfig>['clock'];
	rawWalletClient: ReturnType<typeof buildConnection>['rawWalletClient'];
	publicClient: ReturnType<typeof buildConnection>['publicClient'];
	inFlight: ReturnType<typeof buildInFlight>['inFlight'];
}) {
	const {clock, rawWalletClient, publicClient, inFlight, rawPayment} = params;

	// ----------------------------------------------------------------------------
	// TRACKED WALLET CLIENT
	// ----------------------------------------------------------------------------

	// Wrap the raw wallet client with tracking capabilities
	// This is exposed as `walletClient` for drop-in compatibility
	// Use `walletClient.walletClient` to access the underlying viem WalletClient if needed
	const trackerBuilder = createTrackedWalletClient({
		populateMetadata: true,
		clock: () => clock.now(),
	});
	// GUARDED HERE so every send through it records itself before dispatch: the
	// account executor below is handed this client, and so is anything using
	// `context.walletClient` directly.
	//
	// NOT the only one on this branch. This app builds a SECOND tracked client for
	// the local signer (`buildSignerClient` below), which is a different object and
	// therefore needs its own guard. Nothing can do that on its behalf, so the two
	// call sites are deliberately written to look alike.
	//
	// They differ in one word, and it is the one the user sees. This client
	// PROMPTS, which is the default and therefore unwritten: a send from here goes
	// to a wallet a human has to answer, so "Wallet Action Required" is a true
	// instruction. The signer's passes `{prompts: false}`, because it signs with a
	// key the app already holds and nobody is waiting on anything.
	const walletClient = guardDispatch(
		trackerBuilder.using(rawWalletClient, publicClient),
		inFlight,
	);

	// THE THIRD CLIENT THAT SENDS, AND THE ONE THAT MOVES REAL MONEY.
	//
	// The payment rail carries a wallet client of its own, built by
	// `createPaymentRail` from a SECOND connection with its own payer. It is a
	// different OBJECT from the app wallet client and from the signer client, so
	// guarding those two leaves this one uncovered, and it is the only one whose
	// transactions the user paid for on purpose.
	//
	// The window is the same as everywhere else: the tab can die between the
	// wallet returning a signature and the hash coming back, and a purchase lost
	// there is one the app has no record of and cannot reconcile. That it needs a
	// human at a wallet makes the window LONGER than the signer's, not shorter.
	//
	// Guarded here rather than inside `createPaymentRail`, because the ledger is
	// this app's and the rail is a core building block that must not reach for
	// one. Same reason the app wallet client is guarded at its call site.
	const payment: PaymentRail = {
		...rawPayment,
		walletClient: guardDispatch(rawPayment.walletClient, inFlight),
	};

	return {walletClient, payment, trackerBuilder};
}

/** Who signs, what watches the result, and the connectors that file it. */
function buildExecution(params: {
	signer: ReturnType<typeof buildConnection>['signer'];
	account: ReturnType<typeof buildConnection>['account'];
	deployments: ReturnType<typeof buildConnection>['deployments'];
	publicClient: ReturnType<typeof buildConnection>['publicClient'];
	signerRpcUrl: ReturnType<typeof buildChainConfig>['signerRpcUrl'];
	chainFetchGate: ReturnType<typeof buildChainConfig>['chainFetchGate'];
	trackerBuilder: ReturnType<typeof buildWalletClient>['trackerBuilder'];
	connection: ReturnType<typeof buildConnection>['connection'];
	walletClient: ReturnType<typeof buildWalletClient>['walletClient'];
	accountData: ReturnType<typeof buildChainConfig>['accountData'];
	finality: ReturnType<typeof buildChainConfig>['finality'];
	inFlight: ReturnType<typeof buildInFlight>['inFlight'];
}) {
	const {
		connection,
		walletClient,
		accountData,
		finality,
		inFlight,
		signer,
		account,
		deployments,
		publicClient,
		signerRpcUrl,
		chainFetchGate,
		trackerBuilder,
	} = params;

	// ----------------------------------------------------------------------------
	// TRANSACTION EXECUTOR
	// ----------------------------------------------------------------------------
	// Named for WHOSE KEY SIGNS. Call sites use this instead of the wallet client
	// plus account address, so the `from` address, the account argument and the
	// client can never disagree about who is paying.
	//
	// TRANSACTION EXECUTORS
	//
	// TWO of them, named for WHO SIGNS, and call sites pick by intent. There is no
	// mode and no default: "which account is this transaction from" is a property
	// of what the transaction DOES, not of how the app is configured.
	//
	// - `accountExecutor`: the account the user authenticated as. Prompts. Use it
	//   for anything only the account may do, or that moves the user's own money
	//   (getting an asset out of an app, say).
	// - `signerExecutor`: the local signer, derived at sign-in. Silent, and free
	//   of the user's attention. Use it for whatever the app does on the user's
	//   behalf, which for a game is every move.
	//
	// Both always exist. The signer one simply never reaches `ready` when the app
	// does not sign in, so a call site handles that the same way it already
	// handles "not connected yet" - no optional stores, no branching on config.
	//
	// The signer client is built HERE (not inside the executor) because this is
	// where its concrete pieces live: the chain from deployments, the node RPC
	// URL, and the same tracker config as `walletClient` (so signer transactions
	// get identical metadata/observation wiring). The executor only sees the
	// finished tracked client, keeping it free of construction concerns.
	//
	// MEMOISED across both executors, and that matters for correctness rather
	// than for cost: without it the two would hold DIFFERENT client objects for
	// the same signer, and the tracking connector, which identifies clients by
	// reference, would listen to only one of them. See memoiseSignerClient.
	//
	// GUARDED INSIDE THE MEMOISATION, which is the whole subtlety of this call
	// site. `guardDispatch` returns a WRAPPER, so guarding the result of
	// `buildSignerClient` at each use would hand out a fresh object per call and
	// recreate the very bug the memoisation exists to prevent: tracking identifies
	// clients by reference, so the extra object is one nobody listens to, and its
	// transactions silently stop being reported. Guarding in here keeps one private
	// key mapped to one client OBJECT, which is already guarded.
	//
	// Worth guarding even with no wallet in the loop. The danger window is smaller,
	// since the app signs locally and no human has to answer, but it is not empty:
	// the tab can still die between `eth_sendRawTransaction` leaving and the hash
	// coming back, and that is exactly the case core/transaction exists for.
	//
	// AND GUARDED SILENTLY, `{prompts: false}`, which is the one difference from
	// the wallet client's call site. Guarding is about the RECORD; prompting is
	// about the USER, and this is the client where those two stop coinciding. The
	// app holds this key, so a send here opens no dialog and leaves nobody waiting,
	// and "Wallet Action Required" would be an instruction the user cannot act on
	// about a wallet that was never asked. In a game loop it is worse than useless:
	// it appears and vanishes several times a minute, too fast to read, and teaches
	// the user to ignore the modal for the sends that DO need them.
	//
	// The record is untouched by this, deliberately. The send still counts toward
	// `dispatching`, still arms the unload guard and still lights the sending
	// indicator, because a transaction nobody was asked about is exactly as losable
	// as one a wallet is holding. See core/transaction/dispatch-guard.
	const buildSignerClient = memoiseSignerClient((privateKey) => {
		const account = privateKeyToAccount(privateKey);
		const raw = createWalletClient({
			account,
			chain: deployments.get().chain,
			// Broadcast over the resolved node RPC (PUBLIC_NODE_URL or a chain
			// rpcUrl) when there is one. Hosted sign-in guarantees it (see
			// resolveSignerRpc above, which makes its absence fatal); under
			// wallet-only sign-in every account has a wallet, so the connection
			// provider is a real fallback rather than a hopeful one.
			transport: signerRpcUrl
				? http(signerRpcUrl)
				: custom(connection.provider),
		});
		return {
			client: guardDispatch(trackerBuilder.using(raw, publicClient), inFlight, {
				prompts: false,
			}),
			account,
		};
	});

	const accountExecutor = createExecutor({
		connection,
		walletClient,
		sendFrom: 'account',
		buildSignerClient,
	});

	const signerExecutor = createExecutor({
		connection,
		walletClient,
		sendFrom: 'signer',
		buildSignerClient,
	});

	const accountCannotSend = createAccountCannotSendStore();
	const errorDetails = createErrorDetailsStore();

	// The address each executor sends from, or undefined until it is ready. The
	// matching balance follows it, so a shown or gating balance always belongs to
	// the account that would actually pay.
	const addressOf = (executor: ExecutorStore) =>
		derived(executor, ($executor) =>
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

	// Both executors' clients feed Account Data, so a transaction is recorded
	// whichever key signed it. Operations are keyed by the AUTHENTICATED account,
	// not by the sender, so the signer's moves and the account's transactions
	// belong to the same player and land in one list.
	const trackedWalletConnector = createTrackedWalletConnector({
		walletClient,
		executors: [accountExecutor, signerExecutor],
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

	// Whether this browser's signer may act for the account. Scoped to the
	// account AND its signer, so it resets when either changes, and gated the
	// same way the message poll is: with no app RPC there is nothing to read it
	// over until a wallet is connected.
	const signerAddress = derived(signer, ($signer) => $signer?.address);
	const delegation = createDelegationState({
		publicClient,
		// The one delegation fact this app owns: which of its contracts adopted
		// the library. The entry points come with the module.
		registry: delegationRegistryAddress(deployments.get()),
		// And the chain it is on, because a credential is bound to the PAIR: the
		// same address on another chain is another contract entirely. Same value
		// the connection declares its permission for, from the same place.
		chainId: deployments.get().chain.id,
		account,
		signer: signerAddress,
		fetchGate: chainFetchGate,
	});

	return {
		accountExecutor,
		signerExecutor,
		addressOf,
		signerAddress,
		delegation,
		accountCannotSend,
		errorDetails,
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
	accountExecutor: ReturnType<typeof buildExecution>['accountExecutor'];
	signerExecutor: ReturnType<typeof buildExecution>['signerExecutor'];
	addressOf: ReturnType<typeof buildExecution>['addressOf'];
	chainFetchGate: ReturnType<typeof buildChainConfig>['chainFetchGate'];
}) {
	const {
		publicClient,
		accountExecutor,
		signerExecutor,
		addressOf,
		chainFetchGate,
	} = params;

	// ----------------------------------------------------------------------------
	// BALANCE AND COSTS
	// ----------------------------------------------------------------------------

	// Balance of the account that pays. One account sends everything here, so
	// there is one balance, and it is named for whose it is rather than for the
	// role it plays.
	// One balance per executor, named the same way. A call site that named the
	// executor it sends from names the matching balance, so the two can never
	// drift apart the way a single "the balance" did.
	//
	// Both are plain pollers over one address, and both are inert until something
	// subscribes: an app that never shows the signer's gas never fetches it, and
	// a deployment with no signer never has an address to fetch.
	const accountBalance = createBalanceStore({
		publicClient,
		account: addressOf(accountExecutor),
	});

	// The signer's gas. Not the same thing as "what the app spends": the signer
	// pays for what the app does on the user's behalf, and it starts empty, so
	// this is what the credits UI reads to tell the user they cannot move yet.
	const signerBalance = createBalanceStore({
		publicClient,
		account: addressOf(signerExecutor),
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

	return {
		accountBalance,
		signerBalance,
		gasFee,
		balanceCheck,
		offline,
		txObserverDebug,
	};
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
	/**
	 * What this app's browser key is for, in this app's words.
	 *
	 * A PARAMETER rather than an import, for the same reason `createApp` is one:
	 * this file is the template's half and must not reach into the app's half.
	 * It arrives from `context/index.ts`, which is where the two are composed.
	 * See ui/delegation/grant for what happens when a shared component is left
	 * to guess this instead.
	 */
	signerGrant: SignerGrant;
}): {
	context: Context;
	start: () => () => void;
} {
	const {createApp, signerGrant} = params;
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
		signer,
		chainInfo,
		rawPayment,
		hasLocalSigner,
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
		credits,
		signerRpcUrl,
	} = buildChainConfig({
		deployments,
		connection,
		account,
		targetStep,
		walletOnly,
		fatal,
	});

	const {inFlight} = buildInFlight({
		chain,
		clock,
		appRpcUrl,
		accountData,
		publicClient,
		account,
		deployments,
	});

	const {walletClient, payment, trackerBuilder} = buildWalletClient({
		clock,
		rawWalletClient,
		publicClient,
		inFlight,
		rawPayment,
	});

	const {
		accountExecutor,
		accountCannotSend,
		errorDetails,
		signerExecutor,
		addressOf,
		signerAddress,
		delegation,
		txObserver,
		tabLeader,
		trackedWalletConnector,
		txObserverConnector,
	} = buildExecution({
		connection,
		walletClient,
		accountData,
		signer,
		account,
		deployments,
		publicClient,
		signerRpcUrl,
		chainFetchGate,
		trackerBuilder,
		finality,
		inFlight,
	});

	const {navigation, overlays, toastConnector} = buildNavigation({accountData});

	const {
		accountBalance,
		signerBalance,
		gasFee,
		balanceCheck,
		offline,
		txObserverDebug,
	} = buildBalances({
		publicClient,
		accountExecutor,
		signerExecutor,
		addressOf,
		chainFetchGate,
	});

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

	// Both chain reads that a transaction of ours can invalidate: the messages,
	// and whether the signer is still a delegate. The registration lands in a
	// transaction the app itself sent, so without the second one the UI would go
	// on refusing to send until the next slow poll.
	const onchainStateRefreshConnector = createOnchainStateRefreshConnector({
		txObserver,
		stores: [onchainState, delegation],
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
	// with no app RPC, we use the no-op store so nothing runs. signerRpcUrl is the
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
		// No-op when there is no signer (the poller's gate refuses the fetch), so
		// this stays safe in an app that does not sign in.
		void signerBalance.update();
	};

	// The yes/no questions the app has to ask before going on: "carry on with
	// what you were doing?", "really give up on a run the wallet may still act
	// on?". One mechanism, one modal, and the words come from whoever asks.
	//
	// Built on the overlay registry (it is a prompt overlay), which is why it is
	// created after it and handed it here rather than reaching for a global. See
	// core/ui/confirm and ADR-0004 (`work` branch).
	const confirmation = createConfirmation(overlays);

	// Built here rather than in the component that shows it, because the account
	// panel and the insufficient-funds modal must drive the SAME flow: the modal
	// opens it for a transaction that is already blocked, and the panel opens it
	// on its own, and a second instance would let both run at once.
	const topUp = createTopUpFlow(
		{
			connection,
			payment,
			signerBalance,
			credits,
			signerGrant,
			deployments,
			accountExecutor,
			accountBalance,
			publicClient,
			balanceCheck,
			delegation,
			confirmation,
		},
		{
			faucetApi: PUBLIC_FAUCET_API,
			faucetLink: PUBLIC_FAUCET_LINK,
			hasFaucet,
		},
	);

	// Getting past "this browser may not act for you yet" WITHOUT losing what the
	// user was doing. Built here for the same reason the top-up flow is: the send
	// that was interrupted waits on it, and the modal that resumes it has to be
	// driven by the same instance. See ui/delegation/delegation-check.
	const delegationCheck = createDelegationCheckStore({
		delegation,
		topUp,
		confirmation,
	});

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
		signerBalance,
		credits,
		signerGrant,
		payment,
		signerExecutor,
		hasLocalSigner,
		topUp,
		delegationCheck,
		confirmation,
		// This branch's own: whether the signer may act for the account. Core, not
		// app: the delegation is a property of how this variant authenticates, and
		// the greeting demo merely reads it.
		delegation,
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
