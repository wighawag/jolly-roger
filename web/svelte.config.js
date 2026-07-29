import adapter from '@sveltejs/adapter-static';
import {execSync} from 'node:child_process';
import {vitePreprocess} from '@sveltejs/vite-plugin-svelte';

let VERSION = `timestamp_${Date.now()}`;
try {
	VERSION = execSync('git rev-parse --short HEAD', {
		stdio: ['ignore', 'pipe', 'ignore'],
	})
		.toString()
		.trim();
	try {
		// This command returns empty string if no changes
		const output = execSync('git status --porcelain', {encoding: 'utf8'});
		if (output.trim().length > 0) {
			VERSION += '-dirty';
			console.warn(`[!] repo has some uncommited changes...`);
		}
	} catch (error) {
		console.error('Error checking git status:', error);
		process.exit(1);
	}
} catch (e) {
	console.error(e);
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		version: {
			name: VERSION,
		},
		adapter: adapter({
			assets: 'build',
			pages: 'build',
			fallback: '404.html', // SPA fallback - serves as 404 page on IPFS/static hosts
		}),
		serviceWorker: {
			// we handle it ourselves here : src/service-worker-handler.ts
			register: false,
		},
		paths: {
			// this is to make it work on ipfs (on an unknown path)
			relative: true,
		},
		output: {
			bundleStrategy: 'single', // less files, better for some ipfs gateways
		},
	},
};

export default config;
