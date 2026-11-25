/**
 * WHERE THE SERVICES' OWN LOGS GO (QA F16). push-notification-server (and
 * missiv, in `with/messaging`) report through `named-logs`, a facade that
 * prints NOTHING until a sink is installed: a push the browser's push service
 * refused came back as a 502 with no reason in any pane. This is that sink,
 * to the console, each line prefixed with its logger's name.
 *
 * Errors and warnings by default. `NOTIFIER_LOG_LEVEL` (error, warn, info, log,
 * debug, trace, or 1 to 6) shows more; `NOTIFIER_LOG` (comma separated names,
 * `*` as a wildcard, `-name` to leave one out) narrows which loggers print.
 *
 * ITS OWN FILE, LOADED FIRST, because the loggers are made when the services'
 * modules load (`const logger = logs('...')` at their top level) and a logger
 * made before a sink exists is a no-op for good. `serve.ts` imports this
 * before anything else, and `build.mjs` keeps it a separate module (not
 * bundled in), so it runs before those packages, which are imported at run
 * time. The facade reads the sink from `globalThis._logFactory`, which is how
 * every copy of `named-logs` in node_modules finds the same one.
 */
import {consoleLogFactory} from './log-console';

(globalThis as {_logFactory?: unknown})._logFactory = consoleLogFactory({
	level: process.env.NOTIFIER_LOG_LEVEL,
	names: process.env.NOTIFIER_LOG,
});
