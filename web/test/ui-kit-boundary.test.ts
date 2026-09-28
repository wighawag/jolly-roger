import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

/**
 * `core/` reaches the UI kit only through `$ui`, never through `$lib/shadcn`.
 *
 * The rule (see src/lib/core/ui/README.md): `svelte.config.js` maps `$ui` to a
 * directory, and pointing it somewhere else repaints `core/` without editing
 * it. That promise holds only while EVERY kit import in `core/` goes through
 * the alias. One file that names `$lib/shadcn` directly is one component the
 * swap does not reach, and nothing fails: the app still builds, the suites
 * still pass, and the one dialog that bypassed it keeps the old look inside a
 * repainted app. That is exactly how it was found the first time, in
 * `template-commit-reveal`, in a modal, by reading rather than by a test.
 *
 * This lives HERE, where `$ui` is introduced, so every descendant inherits the
 * rule along with the alias, and a violation added further down the tree fails
 * in the repo that added it rather than in the game that tries the swap.
 *
 * Same shape as `framework-boundary.test.ts` next door, including the empty
 * debt list: an entry has to state why the file cannot go through `$ui` yet.
 */
const KNOWN_LEAKS: Record<string, string> = {};

const root = new URL('..', import.meta.url).pathname;

function coreFiles(): string[] {
	// Tracked files only, so a stray scratch file cannot fail the suite.
	return execFileSync('git', ['ls-files', 'src/lib/core'], {
		cwd: root,
		encoding: 'utf8',
	})
		.split('\n')
		.filter((path) => /\.(ts|svelte)$/.test(path));
}

/**
 * Comments are stripped first because `core/` DOCUMENTS the kit: the modal
 * explains which shadcn file its portal default came from, and the README of
 * this very rule names `$lib/shadcn`. A boundary test that fires on the prose
 * explaining the boundary teaches people to stop writing it. Strings are kept,
 * because an import specifier IS a string.
 */
function stripComments(source: string): string {
	return source
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1 ');
}

/** `$lib/shadcn/...`, or a relative path climbing out of `core/` into it. */
const KIT_BYPASS = /['"](?:\$lib\/shadcn|(?:\.\.\/)+shadcn)(?:\/|['"])/;

function bypassesUiAlias(source: string): boolean {
	return KIT_BYPASS.test(stripComments(source));
}

describe('ui kit boundary', () => {
	const files = coreFiles();
	const offenders = files.filter((path) =>
		bypassesUiAlias(readFileSync(`${root}${path}`, 'utf8')),
	);

	it('finds the files it is meant to police', () => {
		// Guards the guard: a moved directory would make every assertion below
		// vacuously true. Not a count, because the tree ranges from a handful of
		// core files here to several hundred in a game. Instead, assert that the
		// alias is actually in use, which is the thing this rule protects.
		expect(files.length).toBeGreaterThan(0);
		expect(
			files.some((path) =>
				/from ['"]\$ui\//.test(readFileSync(`${root}${path}`, 'utf8')),
			),
		).toBe(true);
	});

	it('recognises a bypass and ignores the prose about one', () => {
		expect(
			bypassesUiAlias(`import {Button} from '$lib/shadcn/ui/button';`),
		).toBe(true);
		expect(bypassesUiAlias(`import {cn} from "../../shadcn/utils.js";`)).toBe(
			true,
		);
		expect(bypassesUiAlias(`import {Button} from '$ui/button';`)).toBe(false);
		expect(
			bypassesUiAlias(`// see $lib/shadcn/ui/dialog/dialog-content.svelte`),
		).toBe(false);
		expect(
			bypassesUiAlias(`<!-- '$lib/shadcn/ui/dialog' owns the default -->`),
		).toBe(false);
	});

	it('keeps $lib/shadcn out of core/, except for known debt', () => {
		const unexpected = offenders.filter((path) => !(path in KNOWN_LEAKS));
		expect(
			unexpected,
			`these import $lib/shadcn from core/. Import the same thing from $ui ` +
				`(and use core/ui/button rather than a kit Button), so that ` +
				`repointing the alias repaints them too. See ` +
				`src/lib/core/ui/README.md.`,
		).toEqual([]);
	});

	it('has no stale entries in the debt list', () => {
		const fixed = Object.keys(KNOWN_LEAKS).filter(
			(path) => !offenders.includes(path),
		);
		expect(
			fixed,
			`these no longer import $lib/shadcn, so remove them from KNOWN_LEAKS`,
		).toEqual([]);
	});
});
