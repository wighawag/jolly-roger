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
//
// `onDocumentLoaded` calls back SYNCHRONOUSLY when the document is already
// parsed, and that matters here: `register()` attaches a `message` listener on
// `navigator.serviceWorker`, and messages a controlling worker sent while the
// page was loading are queued and flushed right after `DOMContentLoaded`.
// Attaching in that same task keeps us ahead of the flush. Deferring it (an
// `await`, a `setTimeout`, or waiting on window's `load`) would drop those
// messages, which for this app are push notifications.
if (!dev) {
	onDocumentLoaded(serviceWorker.register);
}

(globalThis as any).get = get;
