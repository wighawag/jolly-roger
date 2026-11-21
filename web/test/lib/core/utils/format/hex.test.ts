import {describe, it, expect} from 'vitest';
import {truncateHex} from '$lib/core/utils/format/hex';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const HASH =
	'0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('truncateHex', () => {
	it('truncates an address with the default 4/4 window', () => {
		expect(truncateHex(ADDRESS)).toBe('0x1234...5678');
	});

	it('keeps the 0x prefix and honours custom start/end', () => {
		expect(truncateHex(ADDRESS, {start: 6, end: 6})).toBe('0x123456...345678');
	});

	it('truncates a 32-byte hash', () => {
		expect(truncateHex(HASH, {start: 8, end: 4})).toBe('0xabcdef01...6789');
	});

	it('returns empty string for empty input', () => {
		expect(truncateHex('')).toBe('');
	});

	it('returns the value unchanged when it is not longer than the window', () => {
		// 0x + 4 + 4 = 10 chars; a 10-char value should not be truncated.
		expect(truncateHex('0x12345678', {start: 4, end: 4})).toBe('0x12345678');
	});
});
