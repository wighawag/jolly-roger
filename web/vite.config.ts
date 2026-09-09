import {defineConfig} from 'vite';
import {execSync} from 'node:child_process';
import devtoolsJson from 'vite-plugin-devtools-json';
import {sveltekit} from '@sveltejs/kit/vite';
import {extraPlugins} from './vite.plugins.js';

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

export default defineConfig({
	plugins: [
		devtoolsJson(
			FIRST_COMMIT
				? {
						uuid: FIRST_COMMIT,
					}
				: undefined,
		),
		// What THIS project adds, in the one slot every repo in this tree has
		// always put it. Edit `vite.plugins.ts`, not this file: see the note
		// there for why a descendant editing this one buys a merge conflict
		// forever.
		...extraPlugins(),
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
		// make it available across the network
		host: '0.0.0.0',
		// allowed any domain
		allowedHosts: true,
	},
});
