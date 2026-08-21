import type {
	NavigationDriver,
	NavigationState,
} from '../../../../src/lib/core/navigation';

/**
 * A history stack with the same rules as the browser's, so the token logic is
 * tested against something that can actually go wrong: pushing truncates the
 * forward entries, `go` moves an index rather than deleting, and a real
 * navigation lands on an entry that is not ours.
 */
export function createFakeBrowser(url = 'https://app.test/transactions/') {
	const entries: {url: URL; state: NavigationState}[] = [
		{url: new URL(url), state: {}},
	];
	let index = 0;
	let notify: () => void = () => {};
	/**
	 * Whether a traversal asked to go further back than we have entries.
	 *
	 * A real browser's session history contains whatever the user was on BEFORE
	 * this app, so an over-deep `go(-n)` does not clamp: it walks out of the app.
	 * Clamping silently is what let a bug that popped one entry too many pass its
	 * tests, so this records the attempt instead of hiding it.
	 */
	let leftTheApp = false;

	const driver: NavigationDriver = {
		read: () => ({
			url: new URL(entries[index].url),
			token: entries[index].state.overlayToken,
		}),
		push(next, state) {
			entries.length = index + 1;
			entries.push({url: new URL(next), state});
			index = entries.length - 1;
		},
		replace(next, state) {
			entries[index] = {url: new URL(next), state};
		},
		go(delta) {
			const next = index - delta;
			if (next < 0) leftTheApp = true;
			index = Math.max(0, next);
			notify();
		},
		start(fn) {
			notify = fn;
			return () => {
				notify = () => {};
			};
		},
	};

	return {
		driver,
		/** Entries currently in the stack (forward entries included). */
		entries,
		current: () => entries[index],
		index: () => index,
		depth: () => entries.length,
		/** True once a traversal tried to go back past the first entry. */
		leftTheApp: () => leftTheApp,
		/** A real page navigation: a new entry that is nobody's overlay. */
		navigateTo(next: string) {
			entries.length = index + 1;
			entries.push({url: new URL(next, entries[index].url), state: {}});
			index = entries.length - 1;
			notify();
		},
		back(delta = 1) {
			driver.go(delta);
		},
		forward() {
			index = Math.min(entries.length - 1, index + 1);
			notify();
		},
	};
}
