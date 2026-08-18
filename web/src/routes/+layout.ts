import {get} from 'svelte/store';
import {dev} from '$app/environment';
import {PUBLIC_ENABLE_SW_IN_DEV} from '$env/static/public';
import {onDocumentLoaded} from '$lib/core/utils/web/hooks.js';
import {serviceWorker} from '$lib/core/config';

export const prerender = true;
export const trailingSlash = 'always';
export const ssr = true;

// The service worker is registered in production. In dev it is skipped by
// default so HMR/reloads are not intercepted by the SW cache; set
// PUBLIC_ENABLE_SW_IN_DEV=true to opt in when developing the SW itself
// (push notifications, update flow, offline).
//
// `onDocumentLoaded` calls back SYNCHRONOUSLY when the document is already
// parsed, and that matters here: `register()` attaches a `message` listener on
// `navigator.serviceWorker`, and messages a controlling worker sent while the
// page was loading are queued and flushed right after `DOMContentLoaded`.
// Attaching in that same task keeps us ahead of the flush. Deferring it (an
// `await`, a `setTimeout`, or waiting on window's `load`) would drop those
// messages, which for this app are push notifications.
const enableSwInDev = PUBLIC_ENABLE_SW_IN_DEV === 'true';
if (!dev || enableSwInDev) {
	if (dev) {
		console.warn(
			`registering service-worker in dev mode (PUBLIC_ENABLE_SW_IN_DEV=true); HMR and reloads may be intercepted by the SW cache`,
		);
	}
	onDocumentLoaded(serviceWorker.register);
} else {
	console.warn(
		`skipping service-worker registration in dev mode, see src/routes/+layout.ts (set PUBLIC_ENABLE_SW_IN_DEV=true to enable)`,
	);
}

(globalThis as any).get = get;
