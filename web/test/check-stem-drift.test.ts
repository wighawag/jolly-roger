import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';

/**
 * `scripts/check-stem-drift.mjs` finds a shared file left at an OLD version of
 * the stem's, and only that.
 *
 * WHY THIS IS A TEST. The check exists for a mistake that leaves no trace in any
 * other suite: a cascade conflict resolved "ours" on a file the descendant never
 * meant to own. The tree still builds and every test still passes, because the
 * file is a perfectly good file, just the stem's from some weeks ago. Measured in
 * stratagems on 2026-11-15: three such files, one of them the game menu, which
 * had gone on missing a mode the stem added. A check for a mistake nothing else
 * sees is only worth having if it is itself seen to work.
 *
 * IT RUNS THE REAL SCRIPT against scratch git repos in a temp directory: a
 * "stem" branch and a "child" branch forked from it, which is all the shape a
 * stem remote has as far as the script is concerned.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const made: string[] = [];

afterEach(() => {
	while (made.length > 0) {
		const dir = made.pop();
		if (dir) rmSync(dir, {recursive: true, force: true});
	}
});

const IDENTITY = ['-c', 'user.email=test@example.com', '-c', 'user.name=test'];

function git(cwd: string, args: string[]): string {
	const done = spawnSync('git', [...IDENTITY, ...args], {
		cwd,
		encoding: 'utf8',
	});
	if (done.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${done.stderr}`);
	}
	return done.stdout.trim();
}

function write(dir: string, files: Record<string, string>): void {
	for (const [file, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, file)), {recursive: true});
		writeFileSync(join(dir, file), content);
	}
}

function commit(dir: string, files: Record<string, string>, message: string) {
	write(dir, files);
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-qm', message]);
}

/**
 * A repo with this repo's scripts on a `stem` branch holding `files`, and a
 * `child` branch forked from it, checked out.
 */
function scratch(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), 'check-stem-drift-'));
	made.push(dir);
	git(dir, ['init', '-q', '-b', 'stem', '.']);
	mkdirSync(join(dir, 'scripts'), {recursive: true});
	for (const script of [
		'apply-omissions.sh',
		'check-omissions.mjs',
		'check-stem-drift.mjs',
	]) {
		cpSync(join(ROOT, 'scripts', script), join(dir, 'scripts', script));
	}
	// The variant of apply-omissions.sh that some repos carry also runs this;
	// a stub keeps one suite for every repo, as apply-omissions.test.ts does.
	writeFileSync(
		join(dir, 'scripts', 'check-dangling-imports.mjs'),
		'console.log("stub: not what this suite is about");\n',
	);
	commit(dir, {'.offshoot-omissions': '# nothing\n', ...files}, 'stem: init');
	git(dir, ['checkout', '-q', '-b', 'child']);
	return dir;
}

function check(
	dir: string,
	ref?: string,
): {status: number | null; output: string} {
	const args = [join(dir, 'scripts', 'check-stem-drift.mjs')];
	if (ref) args.push(ref);
	const done = spawnSync('node', args, {cwd: dir, encoding: 'utf8'});
	return {status: done.status, output: `${done.stdout}${done.stderr}`};
}

describe('check-stem-drift.mjs', () => {
	it('fails on a file a merge kept at the stem OLD version, naming it', () => {
		const dir = scratch({'menu.svelte': 'v1\n', 'other.ts': 'a\n'});
		git(dir, ['checkout', '-q', 'stem']);
		commit(dir, {'menu.svelte': 'v2, with a new entry\n'}, 'stem: menu v2');
		git(dir, ['checkout', '-q', 'child']);
		commit(dir, {'game.ts': 'mine\n'}, 'child: its own game');
		// The cascade, resolved "ours" for the menu: the child keeps v1.
		git(dir, ['merge', '-q', '--no-ff', '-s', 'ours', 'stem', '-m', 'merge']);

		const {status, output} = check(dir, 'stem');

		expect(status, output).not.toBe(0);
		expect(output).toContain('menu.svelte');
		expect(output, 'a file the child added is not shared').not.toContain(
			'game.ts',
		);
		expect(output, 'a file equal to the stem is not drift').not.toContain(
			'other.ts',
		);
	});

	it('passes a file the child modified into a version of its own', () => {
		const dir = scratch({'config.ts': 'stem\n', 'same.ts': 'same\n'});
		git(dir, ['checkout', '-q', 'stem']);
		commit(dir, {'config.ts': 'stem, later\n'}, 'stem: config later');
		git(dir, ['checkout', '-q', 'child']);
		git(dir, ['merge', '-q', '--no-ff', 'stem', '-m', 'merge']);
		commit(dir, {'config.ts': 'the child, on purpose\n'}, 'child: its config');

		const {status, output} = check(dir, 'stem');

		expect(status, output).toBe(0);
		// The count, so a pass over nothing is visible as one.
		expect(output).toContain('1 shared file(s) differ');
	});

	it('passes a file the repo is merely BEHIND on, which the next merge brings', () => {
		const dir = scratch({'menu.svelte': 'v1\n'});
		git(dir, ['checkout', '-q', 'stem']);
		commit(dir, {'menu.svelte': 'v2\n'}, 'stem: menu v2, not merged yet');
		git(dir, ['checkout', '-q', 'child']);

		const {status, output} = check(dir, 'stem');

		expect(status, output).toBe(0);
		expect(output).toContain('1 of them only behind it');
	});

	it('finds the drift during a merge, from MERGE_HEAD, with no ref given', () => {
		const dir = scratch({'fixture.ts': 'v1\n'});
		git(dir, ['checkout', '-q', 'stem']);
		commit(dir, {'fixture.ts': 'v2\n'}, 'stem: fixture v2');
		git(dir, ['checkout', '-q', 'child']);
		commit(dir, {'fixture.ts': 'mine\n'}, 'child: its fixture');
		// A conflicted merge, resolved by taking a version the stem once had.
		spawnSync('git', [...IDENTITY, 'merge', '-q', 'stem'], {cwd: dir});
		write(dir, {'fixture.ts': 'v1\n'});
		git(dir, ['add', 'fixture.ts']);

		const {status, output} = check(dir);

		expect(status, output).not.toBe(0);
		expect(output).toContain('fixture.ts');
		expect(output).toContain('MERGE_HEAD');
	});

	it('is run by apply-omissions.sh during a merge, which then fails', () => {
		const dir = scratch({'menu.svelte': 'v1\n'});
		git(dir, ['checkout', '-q', 'stem']);
		commit(dir, {'menu.svelte': 'v2\n'}, 'stem: menu v2');
		git(dir, ['checkout', '-q', 'child']);
		git(dir, ['merge', '-q', '--no-commit', '-s', 'ours', 'stem']);

		const done = spawnSync(
			'bash',
			[join(dir, 'scripts', 'apply-omissions.sh')],
			{cwd: dir, encoding: 'utf8'},
		);
		const output = `${done.stdout}${done.stderr}`;

		expect(done.status, output).not.toBe(0);
		expect(output).toContain('menu.svelte');
	});

	it('refuses with no merge and no ref, which is the root, rather than passing', () => {
		const dir = scratch({'a.ts': 'a\n'});

		const {status, output} = check(dir);

		expect(status).not.toBe(0);
		expect(output).toContain('nothing to compare against');
	});

	it('refuses a ref that IS this commit', () => {
		const dir = scratch({'a.ts': 'a\n'});

		const {status, output} = check(dir, 'HEAD');

		expect(status).not.toBe(0);
		expect(output).toContain('IS this commit');
	});
});
