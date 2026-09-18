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
import {createCoreContext, type ConnectionFactory} from './core.js';
import {createAppContext} from './app.js';
import type {Context} from './types.js';

export type {
	CoreServices,
	AppContext,
	AppFactory,
	ConnectionFactory,
	ConnectionRequest,
} from './core.js';

/**
 * @param options.establishConnection WHICH WORLD this context describes. Omit
 * it for the app's own remote chain, which is what a single-world app wants and
 * what every route here passes today. An app offering a second world - another
 * network, or an execution-only node in the tab - builds a context per world and
 * hands each one its own factory. See `ConnectionFactory` in `./core.ts`.
 */
export function createContext(options?: {
	establishConnection?: ConnectionFactory;
}): {
	context: Context;
	start: () => () => void;
} {
	return createCoreContext({
		createApp: createAppContext,
		establishConnection: options?.establishConnection,
	});
}
