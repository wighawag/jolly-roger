import {writable} from 'svelte/store';
import type {
	DropOutcome,
	NavigationDriver,
	NavigationLocation,
	NavigationService,
} from './types';

/**
 * The framework-free half of the navigation seam (ADR-0004).
 *
 * Constructible anywhere and inert until a driver is attached, so the context
 * can hold one on the server too (ADR-0002). Without a driver every query
 * answers "I don't know" (`undefined`) and every command is a no-op, rather than
 * throwing or guessing: nothing off-browser has a history to manipulate.
 */
export function createNavigationService(): NavigationService {
	const store = writable<NavigationLocation | undefined>(undefined);
	let location: NavigationLocation | undefined;
	let driver: NavigationDriver | undefined;

	function sync() {
		location = driver?.read();
		store.set(location);
	}

	return {
		subscribe: store.subscribe,

		current: () => location,

		attach(next) {
			driver = next;
			const stop = next.start(sync);
			sync();
			return () => {
				stop();
				driver = undefined;
				location = undefined;
				store.set(undefined);
			};
		},

		pushEphemeral(token, url) {
			if (!driver || !location) return;
			driver.push(url ?? location.url, {overlayToken: token});
			sync();
		},

		replaceEphemeral(token, url) {
			if (!driver || !location) return;
			driver.replace(url ?? location.url, {overlayToken: token});
			sync();
		},

		replaceLocation(url) {
			if (!driver || !location) return;
			// Keeps whatever token the entry already had, which for an adopted entry
			// is none: rewriting the URL must not turn somebody else's entry into
			// one we believe we may pop.
			driver.replace(url, {overlayToken: location.token});
			sync();
		},

		dropEphemeral(token, options): DropOutcome {
			if (!driver || !location) return 'ignored';

			if (location.token === token) {
				driver.go(options?.count ?? 1);
				// No sync() here: the traversal is asynchronous, and the driver
				// reports it through `notify` when it lands.
				return 'popped';
			}

			// Somebody else's entry is on top (the user navigated on, or another
			// overlay pushed after us). Leaving history alone is the whole point,
			// but a content overlay still has to stop being in the URL, and
			// replacing the current entry does that without stealing a step.
			if (options?.fallbackUrl) {
				driver.replace(options.fallbackUrl, {overlayToken: location.token});
				sync();
				return 'replaced';
			}

			return 'ignored';
		},

		urlWithParam(name, value) {
			if (!location) return undefined;
			const url = new URL(location.url);
			if (value === null) {
				url.searchParams.delete(name);
			} else {
				url.searchParams.set(name, value);
			}
			return url;
		},
	};
}
