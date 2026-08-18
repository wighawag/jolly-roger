/**
 * Ports/URLs shared by `playwright.config.ts` (which starts the servers) and
 * the tests (which navigate to them).
 *
 * Overridable so a run can step aside from whatever else is on the machine.
 * `reuseExistingServer` is false in the config, because a stale server must
 * never silently serve the tests, which means a busy port fails the run
 * outright and there has to be a way to move rather than killing a process
 * that may belong to someone else.
 */
const env = (globalThis as any).process.env;

/** An ordinary static host: no gateway worker, our worker is free to register. */
export const PLAIN_PORT = Number(env.E2E_PORT || 4173);

/** A service worker gateway (inbrowser.link and friends), emulated. */
export const SW_GATEWAY_PORT = Number(env.E2E_SW_GATEWAY_PORT || 4174);

export const PLAIN_URL = `http://127.0.0.1:${PLAIN_PORT}`;
export const SW_GATEWAY_URL = `http://127.0.0.1:${SW_GATEWAY_PORT}`;
