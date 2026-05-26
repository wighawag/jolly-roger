import {defineConfig} from 'vite';
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

export default defineConfig({
	plugins: [
		devtoolsJson(
			FIRST_COMMIT
				? {
						uuid: FIRST_COMMIT,
					}
				: undefined,
		),
		sveltekit(),
	],
	build: {
		emptyOutDir: true,
		minify: false,
		sourcemap: true,
	},
	server: {
		// make it available across the network
		host: '0.0.0.0',
		// allowed any domain
		allowedHosts: true,
	},
});
