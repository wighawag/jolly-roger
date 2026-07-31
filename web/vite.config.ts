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
