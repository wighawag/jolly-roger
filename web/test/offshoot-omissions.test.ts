import {readFileSync} from 'node:fs';
import {existsSync} from 'node:fs';
import {describe, it, expect} from 'vitest';

/**
 * The files this repo deliberately does not carry from its template are still
 * gone.
 *
 * WHY A TEST AND NOT A CONVENTION. A deletion in a repo that merges from a
 * `stem` remote is not settled: the next time the template touches that file,
 * the cascade stops with a modify/delete conflict, and the resolution ("it
 * stays deleted") is one careless `git add -A` away from being reversed. The
 * file then comes back silently, and what it brings back is a suite written for
 * a DIFFERENT app - which is worse than a missing test, because it fails for
 * reasons that have nothing to do with this one and teaches people that the
 * suite is noise.
 *
 * So the intent lives in `.offshoot-omissions`, next to the reason it was
 * omitted, and this asserts the repo matches it. It is deliberately a unit test
 * rather than a lint: it runs in the same command as everything else, and it
 * costs nothing when the list is empty, which is the case in the template
 * itself.
 */
describe('offshoot omissions', () => {
	const ROOT = new URL('../../', import.meta.url);
	const LIST = new URL('.offshoot-omissions', ROOT);

	const entries = existsSync(LIST)
		? readFileSync(LIST, 'utf8')
				.split('\n')
				.map((line) => line.replace(/#.*$/, '').trim())
				.filter((line) => line.length > 0)
		: [];

	it('has a list to read, even when it is empty', () => {
		// Guards the guard: if the file is renamed or moved, every assertion below
		// becomes vacuously true and the omissions stop being checked at all.
		expect(
			existsSync(LIST),
			'.offshoot-omissions should exist at the repo root',
		).toBe(true);
	});

	it('still omits every path it says it omits', () => {
		const back = entries.filter((path) => existsSync(new URL(path, ROOT)));
		expect(
			back,
			`these paths are listed in .offshoot-omissions but exist again, which ` +
				`is what a cascade does when a modify/delete conflict is resolved by ` +
				`keeping the file. Run \`bash scripts/apply-omissions.sh\` to drop ` +
				`them, or remove them from the list if this repo now wants them`,
		).toEqual([]);
	});
});
