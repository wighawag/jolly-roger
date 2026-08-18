import {defineConfig, devices} from '@playwright/test';
import {PLAIN_PORT, SW_GATEWAY_PORT} from './e2e/ports';

const env = (globalThis as any).process.env;

/**
 * E2E configuration.
 *
 * Two servers, both `ipfs-gateway-emulator` over the SAME `build` directory,
 * because the behaviour under test is entirely about which KIND of host the
 * app finds itself on:
 *
 *   - PLAIN_PORT       an ordinary static host, where the app must register
 *                      its own service worker
 *   - SW_GATEWAY_PORT  a service worker gateway, which serves a bootstrap page
 *                      that installs ITS OWN worker at scope `/`, and where the
 *                      app must therefore leave registration alone
 *
 * `pnpm test:e2e` builds first: the app only registers a service worker in a
 * production build, so running these against a dev server proves nothing.
 */
export default defineConfig({
	testDir: './e2e/tests',
	testMatch: '**/*.e2e.ts',

	// NOT parallel: a service worker registration is per-origin global state in
	// the browser profile, so overlapping tests on one origin would race.
	fullyParallel: false,
	workers: 1,

	forbidOnly: !!env.CI,
	retries: env.CI ? 2 : 0,
	reporter: 'list',

	use: {trace: 'on-first-retry'},

	projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],

	webServer: [
		{
			command: `pnpm exec ipfs-emulator --only root -d build -p ${PLAIN_PORT}`,
			port: PLAIN_PORT,
			reuseExistingServer: false,
			stdout: 'ignore',
		},
		{
			command: `pnpm exec ipfs-emulator --gateway sw -d build -p ${SW_GATEWAY_PORT}`,
			port: SW_GATEWAY_PORT,
			reuseExistingServer: false,
			stdout: 'ignore',
		},
	],
});
