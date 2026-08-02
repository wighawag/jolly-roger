import {describe, it, expect, vi, afterEach} from 'vitest';
import {randomId} from '$lib/core/utils/web/random-id';

// The point of this helper is the insecure-context case: a phone reaching the
// dev server over a plain http LAN address, where `crypto.randomUUID` is not
// exposed. Each source is forced explicitly, since the ambient environment
// only ever exercises the first one.

afterEach(() => vi.unstubAllGlobals());

describe('randomId', () => {
	it('uses randomUUID when the context is secure', () => {
		const randomUUID = vi.fn(() => 'uuid-from-secure-context');
		vi.stubGlobal('crypto', {randomUUID, getRandomValues: vi.fn()});

		expect(randomId()).toBe('uuid-from-secure-context');
		expect(randomUUID).toHaveBeenCalledOnce();
	});

	it('falls back to getRandomValues when randomUUID is absent', () => {
		// Insecure context: randomUUID is not exposed, getRandomValues still is.
		vi.stubGlobal('crypto', {
			getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab),
		});

		expect(randomId()).toBe('ab'.repeat(16));
	});

	it('still returns something unique with no web crypto at all', () => {
		vi.stubGlobal('crypto', undefined);

		const first = randomId();
		const second = randomId();
		expect(first).not.toBe(second);
	});
});
