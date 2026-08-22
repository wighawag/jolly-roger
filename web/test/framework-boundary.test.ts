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
 * `src/routes/**` is exempt by definition: routes ARE the framework's surface,
 * and a different framework would replace them wholesale.
 *
 * KNOWN_LEAKS is empty, and that is the point: every `$app/*` import outside
 * the adapter now has to justify itself here, in a list a reviewer reads. It
 * exists rather than being deleted because a leak with a stated reason and an
 * expiry is worth more than one that fails a build and gets worked around.
 */
const KNOWN_LEAKS: Record<string, string> = {};

function sourceFiles(): string[] {
	// Tracked files only, so a stray scratch file cannot fail the suite.
	return execFileSync(
		'git',
		['ls-files', 'src/lib', 'src/service-worker', 'src/app.d.ts'],
		{cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8'},
	)
		.split('\n')
		.filter((path) => /\.(ts|svelte)$/.test(path));
}

const root = new URL('..', import.meta.url).pathname;

describe('framework boundary', () => {
	const offenders = sourceFiles().filter((path) => {
		if (path.startsWith('src/lib/kit/')) return false;
		return /from '\$app\//.test(readFileSync(`${root}${path}`, 'utf8'));
	});

	it('finds the files it is meant to police', () => {
		// Guards the guard: a moved directory or a changed import style would
		// otherwise make every assertion below vacuously true.
		expect(sourceFiles().length).toBeGreaterThan(50);
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
