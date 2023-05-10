import preprocess from 'svelte-preprocess';
import adapter from '@sveltejs/adapter-static';
import {vitePreprocess} from '@sveltejs/kit/vite';
import {execSync} from 'child_process';

function getVersion() {
	try {
		return execSync('git rev-parse --short HEAD').toString().trim();
	} catch {
		const timestamp = Date.now().toString();
		console.error(`could not get commit-hash to set a version id, falling back on timestamp ${timestamp}`);
		return timestamp;
	}
}
const VERSION = getVersion();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [
		vitePreprocess(),
		preprocess({
			// postcss make use of tailwind
			// we ensure it get processed, see postcss.config.cjs
			postcss: true,
		}),
	],

	kit: {
		adapter: adapter(),
		version: {
			// we create a dertemrinistic building using a derterministic version (via git commit, see above)
			name: VERSION,
		},
		alias: {
			// alias for web-config
			'web-config': './src/web-config.json',
			$external: './src/external',
		},
		serviceWorker: {
			// we handle it ourselves here : src/service-worker-handler.ts
			register: false,
		},
		paths: {
			// this is to make it work on ipfs (on an unknown path)
			relative: true,
		},
	},
};

export default config;
