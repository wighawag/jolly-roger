/**
 * Ports/URLs for the gateway emulation servers, shared by
 * `playwright.config.ts` (which starts them) and the tests (which navigate to
 * them).
 *
 * Overridable so a run can step aside from whatever else is on the machine.
 * `reuseExistingServer` is false in the config, because a stale server must
 * never silently serve the tests, which means a busy port fails the run
 * outright and there has to be a way to move rather than killing a process
 * that may belong to someone else.
 *
 * The names and defaults are deliberately SPECIFIC to gateway emulation, rather
 * than the generic `E2E_PORT`/4173 a Playwright suite usually reaches for.
 * These servers are additive: a project inheriting this suite very likely has
 * its own e2e server already on the conventional port, and would then have two
 * servers fighting over it. That is not hypothetical, it is exactly what
 * jolly-roger does with `vite preview` on `E2E_PORT || 4173`.
 */
const env = (globalThis as any).process.env;

/** An ordinary static host: no gateway worker, our worker is free to register. */
export const PLAIN_PORT = Number(env.E2E_GATEWAY_PLAIN_PORT || 4273);

/** A service worker gateway (inbrowser.link and friends), emulated. */
export const SW_GATEWAY_PORT = Number(env.E2E_GATEWAY_SW_PORT || 4274);

export const PLAIN_URL = `http://127.0.0.1:${PLAIN_PORT}`;
export const SW_GATEWAY_URL = `http://127.0.0.1:${SW_GATEWAY_PORT}`;
