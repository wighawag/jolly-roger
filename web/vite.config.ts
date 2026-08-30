import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';
import tailwindcss from '@tailwindcss/vite';
import {execSync} from 'node:child_process';
import devtoolsJson from 'vite-plugin-devtools-json';
import {sveltekit} from '@sveltejs/kit/vite';

let FIRST_COMMIT: string | undefined;

try {
	FIRST_COMMIT = execSync('git rev-list --max-parents=0 HEAD', {
		stdio: ['ignore', 'pipe', 'ignore'],
	})
		.toString()
		.trim();
} catch (e) {
	console.error(e);
}

export default defineConfig(({mode}) => ({
	plugins: [
		devtoolsJson(FIRST_COMMIT ? {uuid: FIRST_COMMIT} : undefined),
		tailwindcss(),
		sveltekit(),
	],
	build: {
		emptyOutDir: true,
		minify: true, // shrink chunks so large files don't stall on slow /
		// throttled connections (an unminified single bundle hung under
		// Chrome's request-level throttling)
		sourcemap: true,
	},
	server: {
		host: '127.0.0.1',
		// Allow all hosts in dev mode so tunnels work instantly
		allowedHosts: mode === 'development' ? true : [],
	},
	test: {
		expect: {requireAssertions: true},
		// HALF THE CORES, because a test run does not own the machine.
		//
		// Vitest defaults to one worker per core, and every worker that touches
		// the app barrel holds its own copy of a large module graph. That is fine
		// alone and falls apart the moment a second suite runs beside it: three of
		// these repos at once (16 cores, 30GB) drove the machine into swap and
		// `test/lib/context/fatal.test.ts` blew its 120s hang guard in ALL THREE,
		// with the whole run taking 27 minutes instead of 30 seconds. The failure
		// looks like a flaky test and is not one: it is 48 forks competing for 8GB.
		//
		// It is not a trade against speed, which is why it is a default rather
		// than something CI passes. Measured on this repo, solo: 19.3s -> 17.4s
		// wall, with transform 65s -> 34s and import 95s -> 46s, because the work
		// saved on contention more than pays for the workers given up. The same
		// three-way run that failed above passes in 80s with this set.
		//
		// A PERCENTAGE, not a number: these repos are cloned onto everything from
		// a laptop to a CI runner, and a hardcoded count is either oversubscribed
		// on the small machine or wasteful on the big one.
		maxWorkers: '50%',
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{browser: 'chromium', headless: true}],
					},
					include: ['test/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['test/lib/server/**'],
				},
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['test/**/*.{test,spec}.{js,ts}'],
					exclude: ['test/**/*.svelte.{test,spec}.{js,ts}'],
				},
			},
		],
	},
}));
