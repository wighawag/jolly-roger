import {LOCK_KEY, STALE_THRESHOLD} from './constants';

export type LockData = {
	tabId: string;
	timestamp: number;
};

/**
 * WHICH ELECTION A LOCK BELONGS TO.
 *
 * One key per origin was right while an app had one context. It is wrong the
 * moment it has two: a page that provides a second WORLD builds a second
 * context, with its own transaction observer over its own chain, and both
 * elect against the same key - so one of them wins and the other's observer
 * never runs. Its transactions mine and stay "pending" forever, which is a
 * failure with no error anywhere. Measured, 2026-09-19.
 *
 * The namespace is the CHAIN the observer watches, because that is what the
 * election is really about: which tab polls for THIS chain's transactions.
 */
function keyFor(namespace?: string): string {
	return namespace ? `${LOCK_KEY}:${namespace}` : LOCK_KEY;
}

/**
 * Attempts to acquire the leader lock for the given tab.
 *
 * Note: The read-check-write pattern here is not atomic (TOCTOU race).
 * On a fresh page load with multiple tabs starting simultaneously, all could read
 * "no lock", all could write their own lock, and all briefly become leaders.
 * This is intentional and safe because the BroadcastChannel conflict resolution
 * in TabLeaderService will quickly resolve any dual-leader situation.
 */
export function acquireLock(tabId: string, namespace?: string): boolean {
	const now = Date.now();
	const existing = readLock(namespace);

	if (existing && existing.tabId !== tabId) {
		// Another tab holds the lock — check if it's still alive
		// A lock is considered stale if not refreshed within the threshold
		if (now - existing.timestamp < STALE_THRESHOLD) {
			return false;
		}
	}

	writeLock({tabId, timestamp: now}, namespace);
	return true;
}

export function refreshLock(tabId: string, namespace?: string): boolean {
	const existing = readLock(namespace);
	if (!existing || existing.tabId !== tabId) {
		return false;
	}
	writeLock({tabId, timestamp: Date.now()}, namespace);
	return true;
}

export function releaseLock(tabId: string, namespace?: string): void {
	const existing = readLock(namespace);
	if (existing && existing.tabId === tabId) {
		try {
			localStorage.removeItem(keyFor(namespace));
		} catch {
			// Ignore storage errors
		}
	}
}

export function readLock(namespace?: string): LockData | undefined {
	try {
		const raw = localStorage.getItem(keyFor(namespace));
		if (!raw) return undefined;
		return JSON.parse(raw) as LockData;
	} catch {
		return undefined;
	}
}

function writeLock(data: LockData, namespace?: string): void {
	try {
		localStorage.setItem(keyFor(namespace), JSON.stringify(data));
	} catch {
		// Ignore storage errors
	}
}
