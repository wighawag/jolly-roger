import {
	createOnchainState,
	type OnchainStateStore,
} from '$lib/onchain/state.js';
import {createViewState} from '$lib/view/index.js';
import {
	createGreetingCounts,
	withGreetingCounts,
	type CountedViewStateStore,
} from '$lib/onchain/indexer/counts.js';
import type {EIP1193Provider} from 'viem';
import {derived, type Readable} from 'svelte/store';
// dynamic, not static: three optional services a deployment configures (and
// a test of the context mocks only the static variables it knows)
import {env} from '$env/dynamic/public';
import {resolveURLForThisPage} from '$lib/core/env/same-host.js';
import {
	createNotifications,
	type Notifications,
} from '$lib/push/notifications.js';
import {
	notificationsConfig,
	notifiedAccount,
	pushServiceWorker,
	publicationSigner,
	type ConnectionLike,
	type PublicationSigning,
} from '$lib/push/sources.js';
import {NEW_GREETING} from '$lib/onchain/notifier/greetings.js';
import {createMessaging, type Messaging} from '$lib/messaging/messaging.js';
import {messagingAccount, messagingConfig} from '$lib/messaging/sources.js';
import {serviceWorker as appServiceWorker, pushRecipients} from '$lib';
import type {TypedDeployments} from '$lib/deployments-store.js';
import type {CoreServices} from './core.js';
import type {SignerGrant} from '$lib/ui/delegation/grant.js';

/**
 * WHAT THIS APP'S BROWSER KEY IS FOR, in this app's own words.
 *
 * The demo posts greetings, so that is what it says. It lives HERE, in the half
 * a fork replaces, because it is the one piece of the authorisation copy that
 * is not true of every app: the template owns the sentences it lands in (see
 * ui/delegation/grant.ts), and they are shown in the two places where being
 * wrong is most expensive - the dialog asking the user to authorise a key, and
 * the account panel row saying what that key can do.
 *
 * It used to be written out inside those two shared files with "greetings" in
 * it, so every app on this tree inherited the demo's sentence. If you are
 * forking this template, this line is one of the few you MUST change.
 */
export const SIGNER_GRANT: SignerGrant = {action: 'post greetings'};

/**
 * THIS APP'S HALF OF THE CONTEXT. The part a fork replaces.
 *
 * `./core.ts` composes everything that is true of any app built on this
 * template, plus this branch's local-signer layer. This file is the greeting
 * demo, and it is the only one of the two a descendant is expected to rewrite.
 *
 * WHY THE SPLIT EXISTS, which is not tidiness. Descendants inherit `core.ts`
 * and merge it down forever, so it wants to differ as little as possible; they
 * REPLACE this file, so it wants to be separable. Keeping both in one function
 * meant every app carried the demo's composition interleaved with the parts it
 * actually needed, and a merge had to tell them apart line by line. It also
 * meant a descendant that HAD split (template-commit-reveal, into `core.ts` and
 * `game.ts`) could not merge from here at all: git compared its short composing
 * `index.ts` against an 800-line monolith, reported one conflict, and never
 * mentioned the file the changes actually belonged in.
 *
 * CORE BUILDS THIS, not the other way round, and the order is the reason.
 * `core.ts` calls the factory partway through its own construction, because the
 * app needs the connection and accountData, and core's refresh wiring and RPC
 * health then need the app's chain reads. Two passes in one direction, rather
 * than a cycle. See the injection point in `core.ts`.
 *
 * REACHED THROUGH THE `$app-specific` ALIAS, never by path (see svelte.config.js).
 * The framework imports `$app-specific`, so an app whose half lives elsewhere (a
 * game keeps it beside its own code) points the alias there and no framework
 * file is edited. What the alias must provide is what this module exports:
 * `createAppContext`, `AppMembers`, `SIGNER_GRANT`, `operationScope`,
 * `delegationRegistry` and `MAIN_PAGE`.
 */
export function createAppContext(core: CoreServices): AppMembers {
	const {
		publicClient,
		deployments,
		account,
		accountData,
		chainFetchGate,
		connection,
	} = core;

	// The demo needs one field of the resolved chain configuration. It takes it
	// from `core.appConfig` rather than having core hand that field over, so an
	// app that needs a different one changes `./config.ts` and this line, and
	// never `./core.ts`.
	const config = {maxMessages: core.appConfig.maxMessages};

	const onchainState = createOnchainState({
		publicClient,
		deployments: deployments.get(),
		config,
		fetchGate: chainFetchGate,
	});

	// THE INDEXER (`with/indexer`), BESIDE the poll above, never instead of it:
	// how many greetings each account has sent, folded in a worker
	// (`$lib/onchain/indexer`), laid over the view as an optional field.
	const greetingCounts = createGreetingCounts({
		provider: connection.provider as unknown as EIP1193Provider,
		deployments: deployments.get(),
		gate: chainFetchGate,
	});

	const directViewState = createViewState({
		onchainState,
		operations: accountData.watchField('operations'),
		// Which address a pending greeting is filed under: it has to be the one the
		// CHAIN will report, or the optimistic entry never reconciles with the
		// confirmed one and sits in the list as a permanent duplicate.
		//
		// The ACCOUNT, because the demo sends `setMessageFor` through the signer
		// registered as its delegate, and the registry attributes the greeting to
		// the account rather than to whichever key signed the transaction.
		account,
		config,
	});

	const viewState = withGreetingCounts(directViewState, greetingCounts);

	// PUSH NOTIFICATIONS (`with/push-notifications`): "notify me of new
	// greetings", this device registered at the push server and the account's
	// trigger at the trigger service, both proven by the delegate key connect
	// derives for this app (`$lib/push`, README.push-notifications.md). With
	// either service unset it says notifications are not configured.
	// the BUILD's mode, as +layout.ts reads it (`$app/environment`), not `$lib`'s
	// `dev`, which a `?dev` query sets too
	const dev = import.meta.env.DEV;
	const signedInAccount = notifiedAccount(
		connection as Readable<ConnectionLike>,
	);
	// a posted push for another account says so (QA F22): who is signed in
	if (typeof window !== 'undefined') {
		pushRecipients.follow(derived(signedInAccount, ($a) => $a?.address));
	}
	const notifications = createNotifications({
		config: notificationsConfig(
			{
				PUBLIC_PUSH_SERVER: resolveURLForThisPage(env.PUBLIC_PUSH_SERVER),
				PUBLIC_VAPID_PUBLIC_KEY: env.PUBLIC_VAPID_PUBLIC_KEY,
				PUBLIC_NOTIFIER: resolveURLForThisPage(env.PUBLIC_NOTIFIER),
			},
			typeof location !== 'undefined' ? location.origin : undefined,
		),
		kind: NEW_GREETING,
		account: signedInAccount,
		// the registration, or why there is none (off in dev, `+layout.ts`), so
		// a signed-in account is not told to sign in (QA F13)
		serviceWorker: pushServiceWorker({
			registers: !dev || env.PUBLIC_ENABLE_SW_IN_DEV === 'true',
			dev,
			state: appServiceWorker,
			container:
				typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
		}),
		signOwnership: publicationSigner(connection as PublicationSigning),
		// what the line offers with no account: the same as a send does
		signIn: () => connection.ensureConnected(),
		// ONE ACCOUNT PER DEVICE (QA F21): enabling here makes this device the
		// current account's alone, so a browser switched to another account stops
		// receiving the previous one's pushes (its direct messages included, which
		// it could not read here). An app that wants one device notified for
		// several accounts sets false; the line then offers both.
		replaceOtherAccounts: true,
	});

	// MESSAGING (`with/messaging`): the domain's chat room and direct messages
	// on missiv, proven by the same delegate key and the same wallet signature as
	// the notifications (`$lib/messaging`, README.messaging.md). With
	// PUBLIC_MISSIV unset the panel says messaging is not configured.
	const messaging = createMessaging({
		config: messagingConfig(
			{PUBLIC_MISSIV: resolveURLForThisPage(env.PUBLIC_MISSIV)},
			typeof location !== 'undefined' ? location.origin : undefined,
			MESSAGING_NAMESPACE,
		),
		account: messagingAccount(connection as Readable<ConnectionLike>),
		signOwnership: publicationSigner(connection as PublicationSigning),
		// what the panel offers with no account, as the notifications line does
		signIn: () => connection.ensureConnected(),
		// a direct message's push, clicked, opens its conversation (QA F19)
		notificationClicks: appServiceWorker.notificationClicks,
	});

	// `config` is not returned: it is this half's own construction detail, and
	// core neither uses it nor puts it in the context.
	return {onchainState, viewState, notifications, messaging};
}

/**
 * THE APP'S MAIN PAGE, named once for the inherited chrome that links to it:
 * the navbar's link (`name`) and the home page's button (`homeLink`), both to
 * `route`. Here it is the greetings demo. A descendant renames or moves its
 * main page HERE, in its own `$app-specific` module, and edits no shared file.
 * The e2e suites name the same page in `MAIN_PAGE` of `web/e2e/routes.ts`; a
 * descendant changes both.
 */
export const MAIN_PAGE = {
	name: 'Demo',
	route: '/demo/',
	homeLink: 'Check The Demo',
} as const;

/**
 * What this app adds to the app context. `Context` (see `./types.ts`) is the
 * framework's members plus these, read through `$app-specific`, so the framework
 * names no type of this app's.
 *
 * Core reads `onchainState` for refreshes and RPC health, and states what it
 * needs of it as `AppContext`; a store that falls short is a compile error
 * where `./index.ts` hands this factory to core.
 */
export type AppMembers = {
	onchainState: OnchainStateStore;
	viewState: CountedViewStateStore;
	/** "notify me of new greetings": this device and the account's trigger */
	notifications: Notifications;
	/** the chat room and direct messages (`with/messaging`) */
	messaging: Messaging;
};

/** The app's conversations within missiv's domain (the page's host). */
const MESSAGING_NAMESPACE = 'greetings';

/**
 * The address that scopes local operation data: which of this app's contracts
 * a browser's operation records belong to.
 *
 * A FUNCTION OF THE TYPED DEPLOYMENTS, not a contract name, so naming a
 * contract the deployment does not have is a compile error here, in the app,
 * rather than a lookup in the framework that answers `undefined`.
 *
 * The contract should be one whose address is stable for the deployment's
 * lifetime (e.g. the main proxy), not its implementation, which changes on
 * every hot contract replacement.
 */
export function operationScope(deployments: TypedDeployments): `0x${string}` {
	return deployments.contracts.GreetingsRegistry.address;
}

/**
 * The contract this app's delegation lives in: whichever of its contracts
 * adopted `UsingDelegation`.
 *
 * WHICH contract is the one thing about delegation that is app-specific: the
 * entry points it exposes are fixed by the library, and their ABI comes from
 * the same package as the Solidity (see onchain/delegation). So an app that
 * replaces the demo points this at its own contract and changes nothing else.
 * Only an address crosses into the framework; what is called on it is typed by
 * `DELEGATION_ABI`, whichever contract implements it.
 *
 * Same rule as above about which address: the one that is stable for the
 * deployment (the proxy), not an implementation.
 */
export function delegationRegistry(
	deployments: TypedDeployments,
): `0x${string}` {
	return deployments.contracts.GreetingsRegistry.address;
}
