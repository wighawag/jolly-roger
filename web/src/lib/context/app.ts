import {
	createOnchainState,
	type OnchainStateStore,
} from '$lib/onchain/state.js';
import {createViewState, type ViewStateStore} from '$lib/view/index.js';
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
 * `createAppContext`, `AppMembers`, `SIGNER_GRANT`, `operationScope` and
 * `delegationRegistry`.
 */
export function createAppContext(core: CoreServices): AppMembers {
	const {publicClient, deployments, account, accountData, chainFetchGate} =
		core;

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

	const viewState = createViewState({
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

	// `config` is not returned: it is this half's own construction detail, and
	// core neither uses it nor puts it in the context.
	return {onchainState, viewState};
}

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
	viewState: ViewStateStore;
};

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
