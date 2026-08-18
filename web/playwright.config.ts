import {defineConfig, devices} from '@playwright/test';
import {PLAIN_PORT, SW_GATEWAY_PORT} from './e2e/ports';

const env = (globalThis as any).process.env;

/**
 * Ports are overridable so a run can step aside from whatever else is on the
 * machine. `webServer.reuseExistingServer` is false (a stale server must never
 * silently serve the tests), which means a busy port fails the run outright -
 * so there has to be a way to move, short of killing a process that may belong
 * to someone else. Keep in step with e2e/fixtures/test.ts.
 */
const PORT = Number(env.E2E_PORT || 4173);

/**
 * Playwright configuration for E2E tests.
 *
 * Tests run against a local Ethereum node with deployed contracts.
 *
 * Use scripts/run-e2e-tests.sh to run the full E2E test suite which handles:
 * - Starting the Hardhat node
 * - Deploying contracts
 * - Building the web app
 * - Running these tests
 * - Cleaning up after tests
 *
 * Or use pnpm test:e2e which runs the script automatically.
 */
export default defineConfig({
	testDir: './e2e/tests',
	testMatch: '**/*.e2e.ts',

	// Run tests in parallel by default
	fullyParallel: true,

	// Fail the build on CI if you accidentally left test.only in the source code
	forbidOnly: !!env.CI,

	// Retry on CI only
	retries: env.CI ? 2 : 0,

	// Limit workers on CI
	workers: env.CI ? 1 : undefined,

	// Reporter to use
	reporter: [
		['html', {open: 'never'}],
		['list'],
		...(env.CI ? [['github'] as const] : []),
	],

	// Shared settings for all projects
	use: {
		baseURL: `http://localhost:${PORT}`,

		// Start each test with empty storage state (no cookies, no localStorage)
		// This ensures tests don't inherit wallet connection state from previous runs
		storageState: {cookies: [], origins: []},

		// Collect trace when retrying the failed test
		trace: 'on-first-retry',

		// Capture screenshot on failure
		screenshot: 'only-on-failure',

		// Video recording on failure
		video: 'on-first-retry',
	},

	// Longer timeout for blockchain operations
	timeout: 120000,
	expect: {
		timeout: 20000,
	},

	// Configure projects for major browsers
	projects: [
		{
			name: 'chromium',
			use: {...devices['Desktop Chrome']},
		},
		// Uncomment to add more browsers
		// {
		// 	name: 'firefox',
		// 	use: {...devices['Desktop Firefox']},
		// },
		// {
		// 	name: 'webkit',
		// 	use: {...devices['Desktop Safari']},
		// },
	],

	// Web server configuration
	// NOTE: reuseExistingServer is false to ensure Playwright always starts a fresh
	// preview server with the newly built app from globalSetup.
	// An ARRAY: this repo's own preview server, plus the two
	// `ipfs-gateway-emulator` servers the inherited service worker gateway
	// suite (e2e/tests/service-worker-gateway.e2e.ts) navigates to. Ports come
	// from e2e/ports.ts so they cannot collide with PORT above.
	webServer: [
	{
			// No `--` before the flag: pnpm passes a bare `--` through verbatim, and
			// `vite preview -- --port N` silently ignores everything after it and serves
			// the default 4173 instead, so Playwright waits on the wrong port until it
			// times out.
			command: `pnpm run preview --port ${PORT}`,
			port: PORT,
			reuseExistingServer: false,
			// Wait for the server to be ready
			timeout: 120000,
		},
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
