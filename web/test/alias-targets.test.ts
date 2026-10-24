import {describe, it, expect} from 'vitest';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

/**
 * Every alias in `svelte.config.js` names a path that exists.
 *
 * Two aliases are where a descendant plugs in: `$ui` (which kit paints
 * `core/`) and `$app-specific` (which app the framework is composed with). A
 * descendant points each at its own module, and a merge from upstream can
 * point it back at a path the descendant deleted long ago, in a hunk that
 * merges CLEANLY. That happened in the first trial cascade of the app slot
 * into reveal-or-die: `$app-specific` arrived aimed at the template's
 * `src/lib/placement/game.ts`, a directory that game had deleted, with no
 * conflict reported.
 *
 * Nothing else catches it at the moment it is made. An alias target is not an
 * import, so `check-dangling-imports` (where a repo has it) never reads it;
 * `svelte-check` does fail, but only in whichever files import the alias, with
 * a "cannot find module" that points away from the config line that caused it.
 * This test names the line.
 *
 * It lives HERE, where `$app-specific` is introduced, so every descendant
 * inherits it with the alias. Its import of the config is the real one, not a
 * parse of the file, so it reads what SvelteKit reads.
 */
const webRoot = resolve(new URL('..', import.meta.url).pathname);

type KitConfig = {kit?: {alias?: Record<string, string>}};

async function aliases(): Promise<Record<string, string>> {
	const mod = (await import('../svelte.config.js')) as {default: KitConfig};
	return mod.default.kit?.alias ?? {};
}

/** SvelteKit accepts `dir/*` as a target; the directory is what must exist. */
function targetPath(target: string): string {
	return resolve(webRoot, target.replace(/\/\*$/, ''));
}

describe('svelte.config.js aliases', () => {
	it('declares the aliases a descendant plugs into', async () => {
		// Guards the guard: an empty or unreadable alias map would make the test
		// below pass without checking anything.
		const names = Object.keys(await aliases());
		expect(names).toContain('$ui');
		expect(names).toContain('$app-specific');
	});

	it('points every alias at a path that exists', async () => {
		const missing = Object.entries(await aliases())
			.filter(([, target]) => !existsSync(targetPath(target)))
			.map(([name, target]) => `${name} -> ${target}`);
		expect(missing).toEqual([]);
	});
});
