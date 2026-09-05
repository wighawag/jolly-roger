import {readFileSync} from 'node:fs';
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
 * The burner accounts this suite uses, for the modes that do NOT go through
 * scripts/run-e2e-tests.sh (`test:e2e:headed`, `:ui`, `:debug`, or a bare
 * `playwright test`). The fixtures require the variable, because funding
 * accounts the app does not offer fails several steps later and for no visible
 * reason, so set it here when it is absent.
 *
 * ONE FILE, read by the script too, so the build under test and the suite
 * driving it cannot disagree about who exists.
 */
env.PUBLIC_IMPERSONATE_ADDRESSES =
	env.PUBLIC_IMPERSONATE_ADDRESSES ||
	(
		JSON.parse(
			readFileSync(
				new URL('./e2e/impersonate-addresses.json', import.meta.url),
				'utf8',
			),
		) as string[]
	).join(',');

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
	//
	// AND LOCALLY, where Playwright's default is half the cores (8 here). Every
	// worker boots a full app against the ONE hardhat node the run starts, and
	// this branch asks far more of it than the template does: a signer, a second
	// payment connection, delegation reads and credits, on top of everything
	// `main` already polls. At 8 the node is the bottleneck and whichever suite
	// happens to be waiting on a chain round-trip loses - which is why the failure
	// moved around (delegation, hosted-signin, escape-hatch, demo) instead of
	// pointing at anything.
	//
	// Measured, not guessed: every one of those passes alone and with fewer
	// workers, and the full suite flaked on five of six runs at the default.
	// `bleeps` capped at 4 for the same reason and the same measurement.
	//
	// THEN LOWERED TO 2 FOR A REASON THAT TURNED OUT TO BE WRONG, left at 2, and
	// written down here because the wrong reason was persuasive enough to cost
	// somebody an afternoon.
	//
	// The story was: fixing the sending-indicator suite meant a SECOND suite
	// walked all the way to a held transaction, two of those against one node was
	// more than 4 workers could feed, and the escape-hatch and sending-indicator
	// failures that followed were the node falling behind. The measurements were
	// real - it did fail at 4 and pass at 2 - and the conclusion was still wrong.
	//
	// Both suites were failing on a fixture bug. `waitUntilHolding` clicked "Sign
	// in" with no timeout, the sign-in modal closes as soon as the signature
	// lands, and Playwright waits for a vanished button forever rather than
	// failing - so the loop never reached its own deadline and the test died on
	// Playwright's 120s timeout. Worker count moved the timing of the race that
	// opened that window, which is exactly why fewer workers looked like a cure.
	// The full suite failed at ONE worker too, which should have settled it.
	//
	// So this cap is not what makes the stalling-wallet suites pass; the fixture
	// fix is. It is kept because the paragraph above it stands on its own
	// evidence, and it has not been re-derived since. If you want the wall clock
	// back, raising it is a reasonable thing to measure - just do not read a
	// stalling-wallet failure as proof that you cannot.
	//
	// What node contention actually looks like, as distinct from that bug: the
	// stalling wallet's own error names the RPC method it is waiting on and for
	// how long. If that message says "nothing", the node is not your problem.
	workers: env.CI ? 1 : 2,

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

		// EVERY ACTION GETS AN END, because Playwright's default is that none of
		// them do (`actionTimeout: 0`). An action waits for its element to be
		// actionable, so a `click` on a locator that matches NOTHING - a button that
		// closed between the check and the click, a row that went stale - does not
		// fail, it waits for the element to appear, forever.
		//
		// The cost of that is not the lost action, it is where the failure lands: a
		// helper that owns a deadline never gets back to it, no diagnostic it was
		// written to print can run, and the test dies on the 120s timeout above
		// pointing at whatever line happened to be executing. This suite has now
		// been bitten twice - `pickSignableAccount` in e2e/fixtures/test.ts bounds
		// its click for this exact reason, and the sign-in click in
		// e2e/fixtures/stalling-wallet.ts cost an afternoon of blaming the node.
		//
		// Well above anything a working app needs (the slowest deliberate wait in
		// the suite is 30s, and it is an `expect`, which this does not govern), so
		// it changes no passing test: it only converts a hang into a failure that
		// names its own line.
		actionTimeout: 30_000,

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
