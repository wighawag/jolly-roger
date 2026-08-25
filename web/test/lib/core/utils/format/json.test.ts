import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {
	bigIntReplacer,
	toPlainJson,
} from '../../../../../src/lib/core/utils/format/json';

/**
 * The bigint that took the transactions page down.
 *
 * `JSON.stringify` throws on a bigint, and DECODED CONTRACT ARGUMENTS are full
 * of them: every uint/int parameter arrives as one. `OperationCard` stringified
 * `metadata.args` with no replacer, so a single numeric argument anywhere in an
 * operation threw "Do not know how to serialize a BigInt" DURING RENDER - not on
 * expanding the details, because the <pre> is in the DOM either way - and the
 * page never appeared.
 *
 * It went unnoticed because the template's own demo sends `setMessage(string)`,
 * which has no numeric argument. It surfaced on a descendant whose contract call
 * takes a uint256.
 *
 * These helpers already existed, documented for exactly this, and were imported
 * by NOTHING. So the second test is the one that matters: it is not about the
 * helpers working, it is about them being USED.
 */
const root = new URL('../../../../../', import.meta.url).pathname;

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

describe('everything that stringifies contract data uses it', () => {
	/**
	 * A grep, deliberately, and not a render test.
	 *
	 * What broke was one call site forgetting the replacer, and a component test
	 * would only ever cover the component someone remembered to write it for.
	 * This asks the question of the whole tree at once: if a file stringifies
	 * decoded arguments or metadata, it has to say how bigints are handled.
	 */
	const files = execFileSync('git', ['ls-files', 'src'], {
		cwd: root,
		encoding: 'utf8',
	})
		.split('\n')
		.filter((path) => /\.(ts|svelte)$/.test(path));

	const offenders = files.filter((path) => {
		const source = readFileSync(`${root}${path}`, 'utf8');
		// `JSON.stringify(<something>.args` or `.metadata`, with no replacer
		// argument before the closing paren or the indent form.
		const calls = source.match(
			/JSON\.stringify\(\s*[^)]*\b(?:args|metadata)\b[^)]*\)/gs,
		);
		if (!calls) return false;
		return calls.some(
			(call) => !/bigIntReplacer|toPlainJson|serializer/.test(call),
		);
	});

	it('finds the call sites it is meant to police', () => {
		// Guards the guard: if the pattern stops matching anything at all, the
		// assertion below is vacuous. There is at least one legitimate stringify
		// of args/metadata in the app (the operation card).
		const anyAtAll = files.filter((path) =>
			/JSON\.stringify\(\s*[^)]*\b(?:args|metadata)\b/s.test(
				readFileSync(`${root}${path}`, 'utf8'),
			),
		);
		expect(anyAtAll.length).toBeGreaterThan(0);
	});

	it('never stringifies decoded arguments without handling bigints', () => {
		expect(
			offenders,
			`these stringify contract args or metadata with no bigint handling, ` +
				`which throws on any uint parameter: ${offenders.join(', ')}. ` +
				`Pass bigIntReplacer from $lib/core/utils/format/json.`,
		).toEqual([]);
	});
});
