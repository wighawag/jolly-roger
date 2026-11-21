import {describe, it, expect} from 'vitest';
import {
	bigIntReplacer,
	toPlainJson,
} from '../../../../../src/lib/core/utils/format/json';

/**
 * `JSON.stringify` throws on a bigint, and data read from a chain or a parsed
 * protocol is full of them. These two helpers are the answer every caller
 * should reach for instead of a bare stringify. A descendant that stringifies
 * such data can add a guard of its own that every call site uses them.
 */
describe('bigIntReplacer', () => {
	it('renders bigints as decimal strings instead of throwing', () => {
		const args = [
			'0x0000000000000000000000000000000000000001',
			10n ** 18n,
			0n,
			{nested: [1n, 2n]},
		];
		expect(() => JSON.stringify(args)).toThrow(/BigInt/);
		expect(JSON.stringify(args, bigIntReplacer)).toBe(
			'["0x0000000000000000000000000000000000000001","1000000000000000000","0",{"nested":["1","2"]}]',
		);
	});

	it('leaves everything else alone', () => {
		const value = {a: 1, b: 'two', c: null, d: [true, false]};
		expect(JSON.parse(JSON.stringify(value, bigIntReplacer))).toEqual(value);
	});

	it('toPlainJson deep-clones through bigints', () => {
		expect(toPlainJson({amount: 5n, deep: {list: [7n]}})).toEqual({
			amount: '5',
			deep: {list: ['7']},
		});
	});
});
