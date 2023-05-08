import preprocess from 'svelte-preprocess';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/kit/vite';
import { execSync } from 'child_process';

function getVersion() {
	try {
		return execSync('git rev-parse --short HEAD').toString().trim();
	} catch {
		const timestamp = Date.now().toString();
		console.error(
			`could not get commit-hash to set a version id, falling back on timestamp ${timestamp}`
		);
		return timestamp;
	}
}
const VERSION = getVersion();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [
		vitePreprocess(),
		preprocess({
			postcss: true,
		}),
	],

	kit: {
		adapter: adapter(),
		version: {
			name: VERSION,
		},
		alias: {
			'web-config': './src/web-config.json',
			$external: './src/external',
		},
		serviceWorker: {
			register: false,
		},
		paths: {
			relative: true,
		},
	},
};

export default config;
