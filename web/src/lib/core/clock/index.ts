import {writable, type Readable} from 'svelte/store';

export type ClockStore = Readable<number> & {
	now(): number;
};

/**
 * Creates a reactive clock store that updates periodically.
 * Maintains the {now(): number} interface for backward compatibility
 * while also being a Svelte store that can be subscribed to.
 *
 * @param interval - Update interval in milliseconds (default: 1000 = 1 second)
 */
export function createClockStore(interval: number = 1000): ClockStore {
	let $now = Date.now();
	let timeout: ReturnType<typeof setTimeout> | undefined;

	const {subscribe} = writable<number>($now, (set) => {
		// Update immediately
		$now = Date.now();
		set($now);

		// Off-browser (SSR / prerender) the clock never ticks: a server render
		// must not leave a timer behind, and a ticking value would differ
		// between prerender and hydration. `now()` still reads the real time.
		// See ADR-0002.
		if (typeof window === 'undefined') return;

		// Set up periodic updates
		function tick() {
			$now = Date.now();
			set($now);
			timeout = setTimeout(tick, interval);
		}

		timeout = setTimeout(tick, interval);

		// Cleanup on unsubscribe
		return () => {
			if (timeout) {
				clearTimeout(timeout);
				timeout = undefined;
			}
		};
	});

	return {
		subscribe,
		now(): number {
			// Always return current time for instant reads
			return Date.now();
		},
	};
}
