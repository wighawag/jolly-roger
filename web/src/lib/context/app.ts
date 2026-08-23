import {createOnchainState} from '$lib/onchain/state.js';
import {createViewState} from '$lib/view/index.js';
import type {CoreServices, AppContext} from './core.js';

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
 */
export function createAppContext(core: CoreServices): AppContext {
	const {publicClient, deployments, account, accountData, chainFetchGate} = core;

	const config = {maxMessages: core.maxMessages};

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
