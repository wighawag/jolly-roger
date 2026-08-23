import {createOnchainState} from '$lib/onchain/state.js';
import {createViewState} from '$lib/view/index.js';
import type {CoreServices, AppContext} from './core.js';

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
