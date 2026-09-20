import {describe, it, expect, beforeEach, vi, afterEach} from 'vitest';
import {
	acquireLock,
	refreshLock,
	releaseLock,
	readLock,
} from '$lib/core/tab-leader/storage-lock';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: (key: string) => store[key] ?? null,
	setItem: (key: string, value: string) => {
		store[key] = value;
	},
	removeItem: (key: string) => {
		delete store[key];
	},
};

Object.defineProperty(globalThis, 'localStorage', {value: localStorageMock});

function clearStore() {
	for (const key of Object.keys(store)) {
		delete store[key];
	}
}

describe('storage-lock', () => {
	beforeEach(() => {
		clearStore();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('acquireLock', () => {
		it('acquires lock when no existing lock', () => {
			expect(acquireLock('tab-1')).toBe(true);
			const lock = readLock();
			expect(lock?.tabId).toBe('tab-1');
		});

		it('acquires lock when same tab already holds it', () => {
			acquireLock('tab-1');
			expect(acquireLock('tab-1')).toBe(true);
		});

		it('rejects lock when another tab holds a fresh lock', () => {
			acquireLock('tab-1');
			expect(acquireLock('tab-2')).toBe(false);
		});

		it('acquires lock when existing lock is stale', () => {
			// Write a stale lock (timestamp far in the past)
			store['tx-observer-leader-lock'] = JSON.stringify({
				tabId: 'tab-old',
				timestamp: Date.now() - 10000,
			});
			expect(acquireLock('tab-new')).toBe(true);
			const lock = readLock();
			expect(lock?.tabId).toBe('tab-new');
		});
	});

	describe('refreshLock', () => {
		it('refreshes lock for the owning tab and updates timestamp', () => {
			acquireLock('tab-1');
			const before = readLock()!.timestamp;
			// Advance time to ensure timestamp differs
			vi.advanceTimersByTime(100);
			expect(refreshLock('tab-1')).toBe(true);
			const after = readLock()!.timestamp;
			expect(after).toBeGreaterThan(before);
		});

		it('fails to refresh lock for a different tab', () => {
			acquireLock('tab-1');
			expect(refreshLock('tab-2')).toBe(false);
		});

		it('fails when no lock exists', () => {
			expect(refreshLock('tab-1')).toBe(false);
		});
	});

	describe('releaseLock', () => {
		it('releases lock for the owning tab', () => {
			acquireLock('tab-1');
			releaseLock('tab-1');
			expect(readLock()).toBeUndefined();
		});

		it('does not release lock held by another tab', () => {
			acquireLock('tab-1');
			releaseLock('tab-2');
			expect(readLock()?.tabId).toBe('tab-1');
		});
	});

	describe('readLock', () => {
		it('returns undefined when no lock', () => {
			expect(readLock()).toBeUndefined();
		});

		it('returns lock data when lock exists', () => {
			acquireLock('tab-1');
			const lock = readLock();
			expect(lock).toBeDefined();
			expect(lock!.tabId).toBe('tab-1');
			expect(lock!.timestamp).toBeGreaterThan(0);
		});

		it('returns undefined for corrupted data', () => {
			store['tx-observer-leader-lock'] = 'not-json';
			expect(readLock()).toBeUndefined();
		});
	});

	// WHY A NAMESPACE EXISTS AT ALL, and it is a bug that was found in a tab
	// rather than here. The lock decides which TAB polls for a transaction's
	// receipt, and one key per origin was right while an app had one context.
	// A page that provides a SECOND world builds a second context with its own
	// observer over its own chain; both elected against this one key, one won,
	// and the loser's observer never ran - so its transactions mined and stayed
	// "pending" forever, with a correct receipt on chain and no error anywhere.
	// It took a chain dump to see, because every other signal said success.
	describe('namespaces', () => {
		it('lets two chains each have a leader in the same tab', () => {
			expect(acquireLock('tab-1', 'chain-a')).toBe(true);
			expect(acquireLock('tab-2', 'chain-b')).toBe(true);
		});

		it('still refuses a second holder WITHIN one namespace', () => {
			// The property the lock exists for has to survive the fix.
			expect(acquireLock('tab-1', 'chain-a')).toBe(true);
			expect(acquireLock('tab-2', 'chain-a')).toBe(false);
		});

		it('keeps the unnamespaced key exactly where it was', () => {
			// An app with one context must not notice this parameter, and an
			// existing lock must not be orphaned by a rename.
			acquireLock('tab-1');
			expect(store['tx-observer-leader-lock']).toBeDefined();
			acquireLock('tab-1', 'chain-a');
			expect(store['tx-observer-leader-lock:chain-a']).toBeDefined();
		});

		it('releases and reads within its own namespace only', () => {
			acquireLock('tab-1', 'chain-a');
			acquireLock('tab-1', 'chain-b');
			releaseLock('tab-1', 'chain-a');
			expect(readLock('chain-a')).toBeUndefined();
			expect(readLock('chain-b')?.tabId).toBe('tab-1');
			expect(refreshLock('tab-1', 'chain-b')).toBe(true);
		});
	});
});
