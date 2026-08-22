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
			// we handle it ourselves: the worker is src/service-worker/index.ts and
			// registration is driven by src/lib/core/service-worker/index.ts
			register: false,
		},
		paths: {
			// this is to make it work on ipfs (on an unknown path)
			relative: true,
		},
		alias: {
			// WHICH UI KIT PAINTS THE BUILDING BLOCKS.
			//
			// Only `src/lib/core/ui/*` imports through this, and only for the small
			// set of components listed in src/lib/core/ui/README.md. Point it at
			// another directory and `core/` is painted by that instead, without
			// editing a single file under `core/`.
			//
			// It resolves to the same place the shadcn CLI writes (see
			// components.json), so `shadcn-svelte add` keeps working untouched.
			//
			// App code (`src/routes`, `src/lib/ui`) is deliberately NOT routed
			// through here. An app owns its own look already; the point of the alias
			// is that the INHERITED part speaks a narrow vocabulary somebody else can
			// implement.
			$ui: 'src/lib/shadcn/ui',
		},
		output: {
			bundleStrategy: 'split', // code-split per route so the initial
			// bundle is small; a single large file stalls under slow /
			// throttled connections (and 'single' is not required for IPFS
			// since paths.relative is already true).
		},
	},
};

export default config;
