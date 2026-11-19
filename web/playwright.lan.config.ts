import {readFileSync} from 'node:fs';
import {defineConfig, devices} from '@playwright/test';

/**
 * The e2e suite against this repo's LAN package, served as a LAN box serves
 * it, with no internet. Run it through `scripts/rehearse-lan.sh`, which builds
 * the package, starts the box's pieces (geth from the box's genesis, the
 * package's deploy, the box's faucet, caddy with the box's rule) on this
 * machine's LAN address and points this config at them.
 *
 * NO webServer: the page under test is the package's static build, served by
 * caddy, exactly the bytes a box would serve.
 *
 * NO INTERNET for the browser: every host name except the LAN address fails
 * to resolve, so a font, a script or a proving key fetched from a CDN shows up
 * as a failure here rather than at an event with no uplink. (An IP literal
 * would still get through; nothing in the app uses one.)
 */
const env = (globalThis as any).process.env;
const LAN_IP = env.E2E_LAN_IP;
const BASE_URL = env.E2E_LAN_URL;
if (!LAN_IP || !BASE_URL) {
	throw new Error(
		'E2E_LAN_IP and E2E_LAN_URL are not set: run this through scripts/rehearse-lan.sh',
	);
}

// The fixtures require it (see e2e/fixtures/test.ts); the build has none, so
// it only sizes the pool of burner accounts the suites claim.
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

export default defineConfig({
	testDir: './e2e/tests',
	// What a LAN box has to support: a player from an empty burner. A game adds
	// its own suites on the command line (`scripts/rehearse-lan.sh e2e/tests/...`).
	testMatch: env.E2E_LAN_TESTS
		? env.E2E_LAN_TESTS.split(',')
		: ['**/faucet.e2e.ts'],
	fullyParallel: true,
	// geth seals a block every two seconds, and every worker waits on it.
	workers: 2,
	reporter: [['list']],
	use: {
		baseURL: BASE_URL,
		storageState: {cookies: [], origins: []},
		actionTimeout: 30_000,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	timeout: 300_000,
	expect: {timeout: 30_000},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: {
					args: [`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${LAN_IP}`],
				},
			},
		},
	],
});
