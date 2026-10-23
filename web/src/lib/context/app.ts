import {
	createOnchainState,
	type OnchainStateStore,
} from '$lib/onchain/state.js';
import {createViewState, type ViewStateStore} from '$lib/view/index.js';
import type {TypedDeployments} from '$lib/deployments-store.js';
import type {CoreServices} from './core.js';

/**
 * THIS APP'S HALF OF THE CONTEXT. The part a fork replaces.
 *
 * `./core.ts` composes everything that is true of any app built on this
 * template: the connection, the executors, balances, transaction observation,
 * navigation and overlays. This file is the greeting demo, and it is the only
 * one of the two a descendant is expected to rewrite.
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
 * `createAppContext`, `AppMembers` and `operationScope`.
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
		// The account a pending greeting belongs to. Here it is also the address
		// that sent it, since this app sends from the authenticated account and
		// nothing else. They are passed separately so that stays an assumption of
		// this app rather than one baked into the view, which an app sending from a
		// key of its own would not share. See lib/view.
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
