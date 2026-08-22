import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

/**
 * `$app/*` belongs to SvelteKit, so it belongs in the adapter layer.
 *
 * The rule (see src/lib/kit/README.md and ADR-0004 on the `work` branch): app
 * behaviour talks to framework-free interfaces, and only `$lib/kit` names the
 * framework. That is what makes swapping it a matter of writing another
 * adapter rather than auditing the tree, and a rule nothing checks is a wish.
 *
 * This rule is INHERITED from `template-svelte`, where it is also enforced, so
 * `core/` arrives here already framework-free rather than being cleaned up
 * after the fact. Keep the two copies in step: a violation introduced upstream
 * would otherwise be discovered here, at merge time.
 *
 * `src/routes/**` is exempt by definition: routes ARE the framework's surface,
 * and a different framework would replace them wholesale.
 *
 * KNOWN_LEAKS is empty, and that is the point: every `$app/*` import outside
 * the adapter now has to justify itself here, in a list a reviewer reads. It
 * exists rather than being deleted because a leak with a stated reason and an
 * expiry is worth more than one that fails a build and gets worked around.
 */
/**
 * Empty here, and it stays that way.
 *
 * `template-svelte` carries one entry, `src/lib/Head.svelte`, for a component
 * that reads `page.url.pathname` to build its canonical URL. This repo does not
 * have that file: the same component lives at `core/metadata/Head.svelte` and
 * takes its location from the `documentLocation` CAPABILITY instead, which is
 * the fix that entry names. The stale-entry check below is what caught the
 * inherited entry when the root's version merged down, which is the mechanism
 * working: a debt list that travels between repos has to be re-earned in each.
 */
const KNOWN_LEAKS: Record<string, string> = {};

const root = new URL('..', import.meta.url).pathname;

function sourceFiles(): string[] {
	// Tracked files only, so a stray scratch file cannot fail the suite.
	return execFileSync(
		'git',
		['ls-files', 'src/lib', 'src/service-worker', 'src/app.d.ts'],
		{cwd: root, encoding: 'utf8'},
	)
		.split('\n')
		.filter((path) => /\.(ts|svelte)$/.test(path));
}

describe('framework boundary', () => {
	const offenders = sourceFiles().filter((path) => {
		if (path.startsWith('src/lib/kit/')) return false;
		return /from '\$app\//.test(readFileSync(`${root}${path}`, 'utf8'));
	});

	it('finds the files it is meant to police', () => {
		// Guards the guard: a moved directory or a changed import style would
		// otherwise make every assertion below vacuously true.
		//
		// Deliberately NOT a file count. This rule is shared with the template
		// tree, which ranges from eighteen files at the root to several hundred
		// here, so any threshold is meaningless at one end or wrong at the other.
		// Instead, assert
		// that the list reaches BOTH sides of the boundary it polices: the adapter
		// it exempts, and the building blocks it protects. If either is missing,
		// the rule is not looking at the thing it claims to.
		const files = sourceFiles();
		expect(files.some((p) => p.startsWith('src/lib/kit/'))).toBe(true);
		expect(files.some((p) => p.startsWith('src/lib/core/'))).toBe(true);
	});

	it('keeps $app/* inside $lib/kit, except for known debt', () => {
		const unexpected = offenders.filter((path) => !(path in KNOWN_LEAKS));
		expect(
			unexpected,
			`these import $app/* outside src/lib/kit. Put the framework-specific ` +
				`part in the adapter layer and talk to it through an interface, or ` +
				`add the file to KNOWN_LEAKS with the reason if it genuinely cannot ` +
				`move yet.`,
		).toEqual([]);
	});

	it('has no stale entries in the debt list', () => {
		// A leak that was fixed must leave the list, or the list stops meaning
		// anything and the next reader trusts it less than they should.
		const fixed = Object.keys(KNOWN_LEAKS).filter(
			(path) => !offenders.includes(path),
		);
		expect(
			fixed,
			`these no longer import $app/*, so remove them from KNOWN_LEAKS`,
		).toEqual([]);
	});
});
