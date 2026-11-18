import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';

/**
 * `scripts/check-divergences.mjs` says which shared files this node modifies
 * without a reason, and which reasons outlived their modification.
 *
 * WHY THIS IS A TEST. The script is the one copy of the check for the whole
 * tree, run by every node's `offshoot-divergences.test.ts` and by
 * `apply-omissions.sh` in the middle of a merge. A check that is wrong in one
 * direction fails a verify for nothing, and wrong in the other passes forever,
 * so both directions are asserted here, on the real script.
 *
 * IT RUNS THE REAL SCRIPT against scratch git repos in a temp directory: a
 * "stem" branch and a "child" branch forked from it, which is all the shape a
 * stem has as far as the script is concerned. The config cases add an
 * `offshoot` branch holding `fanout.config.json` and a `refs/remotes/stem/*`
 * ref, which is what a cross-repo stem looks like from inside the child.
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
	const dir = mkdtempSync(join(tmpdir(), 'check-divergences-'));
	made.push(dir);
	git(dir, ['init', '-q', '-b', 'stem', '.']);
	mkdirSync(join(dir, 'scripts'), {recursive: true});
	for (const script of [
		'apply-omissions.sh',
		'check-omissions.mjs',
		'check-stem-drift.mjs',
		'check-divergences.mjs',
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

/** The `offshoot` config branch, made with plumbing as offshoot-fanout does. */
function config(dir: string, value: unknown): void {
	const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
		cwd: dir,
		input: JSON.stringify(value, null, 2),
		encoding: 'utf8',
	}).stdout.trim();
	const tree = spawnSync('git', ['mktree'], {
		cwd: dir,
		input: `100644 blob ${blob}\tfanout.config.json\n`,
		encoding: 'utf8',
	}).stdout.trim();
	const made = git(dir, ['commit-tree', tree, '-m', 'config']);
	git(dir, ['update-ref', 'refs/heads/offshoot', made]);
}

function check(
	dir: string,
	refs: string[] = [],
	env: Record<string, string> = {},
): {status: number | null; output: string} {
	const done = spawnSync(
		'node',
		[join(dir, 'scripts', 'check-divergences.mjs'), ...refs],
		{
			cwd: dir,
			encoding: 'utf8',
			env: {...process.env, OFFSHOOT_STEM_REFS: '', ...env},
		},
	);
	return {status: done.status, output: `${done.stdout}${done.stderr}`};
}

const LIST = '.offshoot-divergences';

describe('check-divergences.mjs', () => {
	it('passes when every modified shared file is listed with its reason, saying how many', () => {
		const dir = scratch({'a.ts': 'a\n', 'b.ts': 'b\n'});
		commit(
			dir,
			{
				'a.ts': 'mine\n',
				'own.ts': 'new\n',
				[LIST]: 'a.ts  the child needs its a\n',
			},
			'child: its a',
		);

		const {status, output} = check(dir, ['stem']);

		expect(status, output).toBe(0);
		// The count, so a pass over nothing is visible as one.
		expect(output).toContain('1 shared file(s) differ');
	});

	it('fails on a modified shared file with no entry, naming only it', () => {
		const dir = scratch({'a.ts': 'a\n', 'b.ts': 'b\n'});
		commit(
			dir,
			{'a.ts': 'mine\n', 'own.ts': 'new\n', [LIST]: '# nothing yet\n'},
			'child: its a',
		);

		const {status, output} = check(dir, ['stem']);

		expect(status, output).toBe(1);
		expect(output).toContain('a.ts');
		expect(output, 'a file the child added is not shared').not.toContain(
			'own.ts',
		);
		expect(output, 'a file equal to the stem is not modified').not.toContain(
			'b.ts',
		);
	});

	it("fails on a listed file that is the stem's, and on one the stem does not have", () => {
		const dir = scratch({'a.ts': 'a\n'});
		commit(
			dir,
			{
				'own.ts': 'new\n',
				[LIST]: 'a.ts  it used to differ\nown.ts  not a stem file\n',
			},
			'child: a stale list',
		);

		const {status, output} = check(dir, ['stem']);

		expect(status, output).toBe(1);
		expect(output).toContain('a.ts');
		expect(output).toContain('own.ts');
		expect(output).toContain('do not differ');
	});

	it('fails on an entry without a reason, and on a path listed twice', () => {
		const dir = scratch({'a.ts': 'a\n', 'b.ts': 'b\n'});
		commit(
			dir,
			{
				'a.ts': 'mine\n',
				'b.ts': 'mine\n',
				[LIST]: 'a.ts\nb.ts  one reason\nb.ts  another\n',
			},
			'child: a bad list',
		);

		const {status, output} = check(dir, ['stem']);

		expect(status, output).toBe(1);
		expect(output).toContain('line 1: a.ts');
		expect(output).toContain('listed twice');
	});

	it('compares the working tree, so an edit fails before it is committed', () => {
		const dir = scratch({'a.ts': 'a\n'});
		commit(dir, {[LIST]: '# nothing\n'}, 'child: list');
		write(dir, {'a.ts': 'edited, not committed\n'});

		const {status, output} = check(dir, ['stem']);

		expect(status, output).toBe(1);
		expect(output).toContain('a.ts');
	});

	it('compares against the stem commit last merged, not the stem branch tip', () => {
		const dir = scratch({'a.ts': 'a\n'});
		commit(dir, {[LIST]: '# nothing\n'}, 'child: list');
		git(dir, ['checkout', '-q', 'stem']);
		commit(dir, {'a.ts': 'the stem moved on\n'}, 'stem: a later');
		git(dir, ['checkout', '-q', 'child']);

		const {status, output} = check(dir, ['stem']);

		expect(status, output).toBe(0);
	});

	it("does not check the entries of the stem's sections, only the last section's", () => {
		// An in-repo branch inherits its stem branch's list by merge and adds its
		// own entries below a `[branch]` marker. The stem's entries describe the
		// stem against ITS stem and are checked there.
		const dir = scratch({'a.ts': 'a\n', 'b.ts': 'b\n'});
		commit(
			dir,
			{
				'b.ts': 'mine\n',
				[LIST]:
					'a.ts  the stem branch changed a\n[child]\nb.ts  the child changed b\n',
			},
			'child: its b',
		);

		const {status, output} = check(dir, ['stem']);

		expect(status, output).toBe(0);
		expect(output).toContain('1 inherited');
	});

	it('takes a file one of two stems brought as theirs, and a file both lack as a divergence', () => {
		const dir = scratch({'a.ts': 'a\n', 'b.ts': 'b\n', 'c.ts': 'c\n'});
		git(dir, ['checkout', '-q', '-b', 'other', 'stem']);
		commit(dir, {'b.ts': 'the other stem\n', 'o.ts': 'its own\n'}, 'other');
		git(dir, ['checkout', '-q', 'child']);
		git(dir, ['merge', '-q', '--no-ff', 'other', '-m', 'merge other']);
		commit(
			dir,
			{'c.ts': 'mine\n', [LIST]: 'c.ts  the integration needs it\n'},
			'child: its c',
		);

		const {status, output} = check(dir, ['stem', 'other']);

		expect(status, output).toBe(0);
		expect(output).toContain('1 shared file(s) differ');
	});

	it('reads the stems from OFFSHOOT_STEM_REFS when no ref is given', () => {
		const dir = scratch({'a.ts': 'a\n'});
		commit(dir, {'a.ts': 'mine\n', [LIST]: '# nothing\n'}, 'child: a');

		const {status, output} = check(dir, [], {OFFSHOOT_STEM_REFS: 'stem'});

		expect(status, output).toBe(1);
		expect(output).toContain('a.ts');
	});

	it("reads an in-repo node's stems from the offshoot config, naming the node by its marker", () => {
		const dir = scratch({'a.ts': 'a\n', 'b.ts': 'b\n'});
		git(dir, ['branch', '-q', 'main', 'stem']);
		config(dir, {
			stem: 'github:example/parent',
			branches: {main: {}, 'with/x': {stem: 'main'}},
		});
		commit(dir, {'b.ts': 'mine\n', [LIST]: '[with/x]\n'}, 'with/x: its b');

		const {status, output} = check(dir);

		expect(status, output).toBe(1);
		expect(output).toContain('b.ts');
		expect(output).toContain('with/x');
	});

	it("reads a cross-repo node's stem from stemBranch on the stem remote", () => {
		const dir = scratch({'a.ts': 'a\n'});
		git(dir, ['update-ref', 'refs/remotes/stem/variant', 'stem']);
		config(dir, {
			stem: 'github:example/parent',
			branches: {main: {stemBranch: 'variant'}},
		});
		commit(
			dir,
			{'a.ts': 'mine\n', [LIST]: 'a.ts  the game needs it\n'},
			'main: its a',
		);

		const {status, output} = check(dir);

		expect(status, output).toBe(0);
		expect(output).toContain('stem/variant');
	});

	it('fails when its marker names a branch the config does not list', () => {
		const dir = scratch({'a.ts': 'a\n'});
		config(dir, {stem: 'github:example/parent', branches: {main: {}}});
		git(dir, ['update-ref', 'refs/remotes/stem/main', 'stem']);
		commit(dir, {[LIST]: '[integration]\n'}, 'a list from another repo');

		const {status, output} = check(dir);

		expect(status, output).toBe(1);
		expect(output).toContain('integration');
	});

	it("says a list that is its stem's byte for byte is not this node's, and checks nothing", () => {
		// A node that has not written a list yet carries its stem's by cascade.
		const dir = scratch({'a.ts': 'a\n', [LIST]: 'z.ts  the stem changed z\n'});
		commit(dir, {'a.ts': 'mine\n'}, 'child: its a, no list of its own');

		const {status, output} = check(dir, ['stem']);

		expect(status, output).toBe(2);
		expect(output).toContain('no list of its own');
	});

	it("says a list from the stem repo, naming one of ITS branches, is not this node's when it is the stem's byte for byte", () => {
		// A child repo whose stem branch is a multi-branch repo's `integration`
		// inherits that list, whose last marker names `integration`.
		const list = 'z.ts  the stem changed z\n[integration]\ny.ts  and y\n';
		const dir = scratch({'a.ts': 'a\n', [LIST]: list});
		git(dir, ['update-ref', 'refs/remotes/stem/integration', 'stem']);
		config(dir, {
			stem: 'github:example/parent',
			branches: {main: {stemBranch: 'integration'}},
		});
		commit(dir, {'a.ts': 'mine\n'}, 'child: its a, no list of its own');

		const {status, output} = check(dir);

		expect(status, output).toBe(2);
		expect(output).toContain('no list of its own');
	});

	it('reads origin/offshoot when the local offshoot branch is an older version of it', () => {
		const dir = scratch({'a.ts': 'a\n', 'b.ts': 'b\n'});
		git(dir, ['branch', '-q', 'main', 'stem']);
		config(dir, {stem: 'github:example/parent', branches: {main: {}}});
		const old = git(dir, ['rev-parse', 'offshoot']);
		config(dir, {
			stem: 'github:example/parent',
			branches: {main: {}, 'with/x': {stem: 'main'}},
		});
		// The newer config, one commit on top of the old, as origin's.
		const newer = git(dir, ['rev-parse', 'offshoot']);
		const tree = git(dir, ['rev-parse', `${newer}^{tree}`]);
		const onTop = git(dir, [
			'commit-tree',
			tree,
			'-p',
			old,
			'-m',
			'config, later',
		]);
		git(dir, ['update-ref', 'refs/remotes/origin/offshoot', onTop]);
		git(dir, ['update-ref', 'refs/heads/offshoot', old]);
		commit(
			dir,
			{'b.ts': 'mine\n', [LIST]: '[with/x]\nb.ts  its b\n'},
			'with/x: its b',
		);

		const {status, output} = check(dir);

		expect(status, output).toBe(0);
	});

	it('says there is nothing to check where there is no list', () => {
		const dir = scratch({'a.ts': 'a\n'});

		const {status, output} = check(dir, ['stem']);

		expect(status, output).toBe(2);
		expect(output).toContain(`no ${LIST}`);
	});

	it('refuses at the root, whose config names no stem, rather than passing', () => {
		const dir = scratch({'a.ts': 'a\n'});
		config(dir, {stem: null});
		commit(dir, {[LIST]: '# the root has no stem\n'}, 'a list at the root');

		const {status, output} = check(dir);

		expect(status, output).toBe(1);
		expect(output).toContain('nothing to compare against');
	});

	it('refuses with no merge, no ref and no config, rather than passing', () => {
		const dir = scratch({'a.ts': 'a\n'});
		commit(dir, {[LIST]: '# nothing\n'}, 'child: list');

		const {status, output} = check(dir);

		expect(status, output).toBe(1);
		expect(output).toContain('nothing to compare against');
	});

	it('refuses a ref that IS this commit', () => {
		const dir = scratch({'a.ts': 'a\n'});
		commit(dir, {[LIST]: '# nothing\n'}, 'child: list');

		const {status, output} = check(dir, ['HEAD']);

		expect(status, output).toBe(1);
		expect(output).toContain('IS this commit');
	});

	it('checks a merge in progress against MERGE_HEAD, and apply-omissions.sh then fails', () => {
		const dir = scratch({'a.ts': 'a\n'});
		commit(dir, {'a.ts': 'mine\n', [LIST]: 'a.ts  mine\n'}, 'child: a');
		git(dir, ['checkout', '-q', 'stem']);
		commit(dir, {'a.ts': 'mine\n'}, 'stem: takes the child version');
		git(dir, ['checkout', '-q', 'child']);
		git(dir, ['merge', '-q', '--no-commit', '--no-ff', 'stem']);

		const {status, output} = check(dir);
		expect(status, output).toBe(1);
		expect(output).toContain('MERGE_HEAD');
		expect(output).toContain('do not differ');

		const done = spawnSync(
			'bash',
			[join(dir, 'scripts', 'apply-omissions.sh')],
			{
				cwd: dir,
				encoding: 'utf8',
				env: {...process.env, OFFSHOOT_STEM_REFS: ''},
			},
		);
		const applied = `${done.stdout}${done.stderr}`;
		expect(done.status, applied).not.toBe(0);
		expect(applied).toContain('a.ts');
	});

	it('lets apply-omissions.sh pass a merge at a node with no list of its own', () => {
		const dir = scratch({'a.ts': 'a\n', [LIST]: 'z.ts  the stem changed z\n'});
		git(dir, ['checkout', '-q', 'stem']);
		commit(dir, {'b.ts': 'b\n'}, 'stem: b');
		git(dir, ['checkout', '-q', 'child']);
		git(dir, ['merge', '-q', '--no-commit', '--no-ff', 'stem']);

		const done = spawnSync(
			'bash',
			[join(dir, 'scripts', 'apply-omissions.sh')],
			{
				cwd: dir,
				encoding: 'utf8',
				env: {...process.env, OFFSHOOT_STEM_REFS: ''},
			},
		);

		expect(done.status, `${done.stdout}${done.stderr}`).toBe(0);
	});
});
