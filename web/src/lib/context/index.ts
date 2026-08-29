/**
 * The app context, composed.
 *
 * Two halves, deliberately in two files:
 *
 * - `./core.ts` is the template's. Connection, executors, balances, transaction
 *   observation, in-flight safety, navigation and overlays. A descendant merges
 *   it down from upstream forever, so the less it differs the better.
 * - `./app.ts` is THIS app: the greeting demo's chain reads and view model. It
 *   is the half a fork replaces, and the only one it should need to.
 *
 * The core builds the app rather than the other way round, because the order
 * matters: the app needs the connection and accountData, and core's refresh
 * wiring and RPC health then need the app's chain reads. See the injection
 * point in `core.ts`.
 */
import {createCoreContext} from './core.js';
import {createAppContext, SIGNER_GRANT} from './app.js';
import type {Context} from './types.js';

export type {CoreServices, AppContext, AppFactory} from './core.js';

export function createContext(): {
	context: Context;
	start: () => () => void;
} {
	// Both of the app's contributions travel the same way, and for the same
	// reason: `core.ts` must not import `app.ts`. The grant is the app's answer
	// to "what is this browser's key for", which two pieces of shared UI need and
	// neither can work out. See ui/delegation/grant.
	return createCoreContext({
		createApp: createAppContext,
		signerGrant: SIGNER_GRANT,
	});
}
