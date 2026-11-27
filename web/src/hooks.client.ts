import type {ClientInit} from '@sveltejs/kit';
import {pushHandoffs} from '$lib/push-handoffs';

/**
 * Runs once when the app starts in the browser, before SvelteKit's router
 * reads the URL and before the root layout (and `$lib`) loads: the moment a
 * push's hand-off (`#push-handoff=...`, QA F23) must be read and removed, so
 * neither the router nor the app's hash parameters ever see it, and its
 * `popstate`/`hashchange` listeners go before the router's. Imports nothing
 * else of the app, which would evaluate it first.
 */
export const init: ClientInit = () => {
	pushHandoffs.install(window);
};
