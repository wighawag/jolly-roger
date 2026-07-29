import {get} from 'svelte/store';
import {dev} from '$app/environment';
import {onDocumentLoaded} from '$lib/core/utils/web/hooks.js';
import {serviceWorker} from '$lib/core/config';

export const prerender = true;
export const trailingSlash = 'always';
export const ssr = true;

// The service worker is only registered in production. In dev it would
// intercept HMR/reloads with the SW cache, which is annoying during
// development.
if (!dev) {
	onDocumentLoaded(serviceWorker.register);
}

(globalThis as any).get = get;
