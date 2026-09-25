import {spawnSync} from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';

/**
 * `scripts/apply-omissions.sh` does what the list says, and ONLY what the list
 * says.
 *
 * WHY THIS IS A TEST AND NOT A CAREFUL READ. That script is the one command for
 * resolving a modify/delete conflict, so the only time it runs is inside a
 * merge, on a working tree holding resolutions that are not committed yet. It is
 * the worst place in this tree to discover a bug, and the least visited: a repo
 * can go months without a conflict that needs it. Both defects below survived
 * exactly that way.
 *
 * A DIRECTORY ENTRY DID NOT WORK AT ALL, and the list recommends directory
 * entries. `git rm` refuses a directory without `-r`, `set -e` aborted the run
 * on the spot, every later entry was left in place, and the stem check at the
 * end never ran. The output was git's own `fatal: not removing 'x' recursively
 * without -r`, mid-merge, which reads as though the merge were broken rather
 * than the tool.
 *
 * A `*` ENTRY DELETED THE WORKING TREE AND PRINTED A GREEN TICK. To `git rm` an
 * entry is a PATHSPEC, so one stray character in a hand-maintained text file
 * meant "remove every tracked path", recursively, inside a merge; measured on
 * the version before this suite existed, the run left `.git` and nothing else,
 * and said `✓ Dropped 1 path(s)`. Entries are now validated as literal paths
 * inside the repo before anything is removed.
 *
 * IT RUNS THE REAL SCRIPT against a scratch git repo in a temp directory, so
 * what is asserted is the file that ships rather than a copy of its logic.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const made: string[] = [];

afterEach(() => {
	while (made.length > 0) {
		const dir = made.pop();
		if (dir) rmSync(dir, {recursive: true, force: true});
	}
});

function git(cwd: string, args: string[]): void {
	const done = spawnSync('git', args, {cwd, encoding: 'utf8'});
	if (done.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${done.stderr}`);
	}
}

/** A repo with this repo's scripts, the given list, and the given files in it. */
function scratch(list: string, files: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), 'apply-omissions-'));
	made.push(dir);

	git(dir, ['init', '-q', '.']);
	mkdirSync(join(dir, 'scripts'), {recursive: true});
	for (const script of ['apply-omissions.sh', 'check-omissions.mjs']) {
		cpSync(join(ROOT, 'scripts', script), join(dir, 'scripts', script));
	}
	// A STUB FOR THE SIBLING CHECK, so this suite asserts the same thing in every
	// repo in the tree. `template-commit-reveal` and `reveal-or-die` carry a
	// variant of the script that also runs `check-dangling-imports.mjs` and gates
	// its last line behind it; that check needs a real module graph and is not
	// what is being tested here. Standing in for it keeps one suite rather than
	// two, and the variant's own behaviour is asserted where it lives.
	writeFileSync(
		join(dir, 'scripts', 'check-dangling-imports.mjs'),
		'console.log("stub: not what this suite is about");\n',
	);

	for (const file of files) {
		mkdirSync(dirname(join(dir, file)), {recursive: true});
		writeFileSync(join(dir, file), 'content\n');
	}
	writeFileSync(join(dir, '.offshoot-omissions'), list);

	git(dir, ['add', '-A']);
	git(dir, [
		'-c',
		'user.email=test@example.com',
		'-c',
		'user.name=test',
		'commit',
		'-qm',
		'init',
	]);
	return dir;
}

function apply(dir: string): {status: number | null; output: string} {
	const done = spawnSync('bash', [join(dir, 'scripts', 'apply-omissions.sh')], {
		cwd: dir,
		encoding: 'utf8',
	});
	return {status: done.status, output: `${done.stdout}${done.stderr}`};
}

describe('apply-omissions.sh', () => {
	it('drops a DIRECTORY entry, and keeps going afterwards', () => {
		const dir = scratch('game/\nlater.txt\n', [
			'game/render.ts',
			'game/nested/deep.ts',
			'later.txt',
		]);

		const {status, output} = apply(dir);

		expect(
			status,
			`the script failed, which is what "git rm" without -r does to a ` +
				`directory entry:\n${output}`,
		).toBe(0);
		expect(existsSync(join(dir, 'game')), 'the directory should be gone').toBe(
			false,
		);
		expect(
			existsSync(join(dir, 'later.txt')),
			'the entry AFTER the directory should have been handled too - an abort ' +
				'part-way through the list is the failure worth catching',
		).toBe(false);
	});

	it('drops a directory that is present but untracked, which is what a merge leaves', () => {
		const dir = scratch('game/\n', []);
		mkdirSync(join(dir, 'game'), {recursive: true});
		writeFileSync(join(dir, 'game', 'arrived.ts'), 'content\n');

		const {status, output} = apply(dir);

		expect(status, output).toBe(0);
		expect(
			existsSync(join(dir, 'game')),
			'`rm -f` cannot remove a directory, so this one used to be reported as ' +
				'dropped while still sitting there',
		).toBe(false);
	});

	it('refuses a pattern, and removes nothing at all', () => {
		const dir = scratch('*\n', ['keep.txt', 'src/keep.ts']);

		const {status, output} = apply(dir);

		expect(status, 'a pathspec is not an entry').not.toBe(0);
		expect(output).toContain('never a pattern');
		expect(
			existsSync(join(dir, 'keep.txt')) && existsSync(join(dir, 'src/keep.ts')),
			'this is the one that deleted the whole working tree and reported ' +
				'success, so nothing may be removed here',
		).toBe(true);
	});

	it('refuses a path that points outside the repo, and one that is absolute', () => {
		for (const entry of ['../outside.txt', '/etc/passwd']) {
			const dir = scratch(`${entry}\n`, ['keep.txt']);
			const {status, output} = apply(dir);
			expect(status, `${entry} should be refused`).not.toBe(0);
			expect(output).toContain('✗');
			expect(existsSync(join(dir, 'keep.txt'))).toBe(true);
		}
	});

	it('refuses the whole list when ONE entry is bad, before removing any of it', () => {
		// The first entry is perfectly good and must still be there afterwards:
		// half-applied inside a merge leaves a tree matching neither side.
		const dir = scratch('doomed.txt\n*\n', ['doomed.txt', 'keep.txt']);

		const {status} = apply(dir);

		expect(status).not.toBe(0);
		expect(
			existsSync(join(dir, 'doomed.txt')),
			'the list is validated in full before anything is removed',
		).toBe(true);
	});

	it('says so and changes nothing when every listed path is already absent', () => {
		const dir = scratch('gone.txt\nalso/gone/\n', ['keep.txt']);

		const {status, output} = apply(dir);

		expect(status, output).toBe(0);
		expect(output).toContain('Nothing to drop');
		expect(existsSync(join(dir, 'keep.txt'))).toBe(true);
	});
});
