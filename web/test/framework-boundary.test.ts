import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

/**
 * `$app/*` belongs to SvelteKit, so it belongs in the adapter layer.
 *
 * The rule (see src/lib/kit/README.md): app behaviour talks to framework-free
 * interfaces, and only `$lib/kit` names the framework. That is what makes
 * swapping it a matter of writing another adapter rather than auditing the
 * tree, and a rule nothing checks is a wish.
 *
 * This lives at the ROOT template deliberately. `core/` is inherited by every
 * descendant of this repo, several of them byte-identical, so a rule stated
 * here is inherited too and a violation introduced here would otherwise be
 * discovered by a descendant at merge time.
 *
 * `src/routes/**` is exempt by definition: routes ARE the framework's surface,
 * and a different framework would replace them wholesale.
 *
 * KNOWN_LEAKS is empty, and that is the point: every `$app/*` import outside
 * the adapter now has to justify itself here, in a list a reviewer reads. It
 * exists rather than being deleted because a leak with a stated reason and an
 * expiry is worth more than one that fails a build and gets worked around.
 */
const KNOWN_LEAKS: Record<string, string> = {
	'src/lib/Head.svelte':
		'reads `page.url.pathname` for the canonical and og:url. Parameterising it ' +
		'was tried and reverted: the prop has to be optional or every one of a ' +
		"site's <Head> call sites becomes a compile error, and an optional one " +
		'silently defaults the URL of every page to "/". Two descendants have ten ' +
		'such call sites between them, none of which would have failed a test. ' +
		'The fix is a documentLocation CAPABILITY, which the component reads from ' +
		'context so call sites pass nothing and SSR still works; jolly-roger ' +
		'already does exactly this in core/metadata/Head.svelte. Until that ' +
		'exists here, a stated leak beats a silent metadata regression.',
};

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
		// Deliberately NOT a file count. This rule is inherited by descendants
		// that range from eighteen files here to several hundred, so any threshold
		// is either meaningless at one end or wrong at the other. Instead, assert
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
