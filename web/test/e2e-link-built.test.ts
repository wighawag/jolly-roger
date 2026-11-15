import {spawnSync} from 'node:child_process';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';

/**
 * `scripts/e2e-link-built.mjs` links what a game declares it builds, and
 * refuses everything else before linking anything.
 *
 * It runs only inside `scripts/run-e2e-tests.sh`, minutes into a run, so a
 * defect in it would be found as a build failure in the e2e worktree, far from
 * its cause. This runs the real script against two temp directories standing in
 * for the main checkout and the worktree.
 */
const SCRIPT = fileURLToPath(
	new URL('../../scripts/e2e-link-built.mjs', import.meta.url),
);
const made: string[] = [];

afterEach(() => {
	while (made.length > 0) {
		const dir = made.pop();
		if (dir) rmSync(dir, {recursive: true, force: true});
	}
});

function dirs(e2e: unknown, built: string[]): {repo: string; tree: string} {
	const repo = mkdtempSync(join(tmpdir(), 'e2e-link-built-repo-'));
	const tree = mkdtempSync(join(tmpdir(), 'e2e-link-built-tree-'));
	made.push(repo, tree);
	writeFileSync(
		join(repo, 'package.json'),
		JSON.stringify(e2e === undefined ? {name: 'game'} : {name: 'game', e2e}),
	);
	for (const path of built) {
		mkdirSync(join(repo, path), {recursive: true});
		writeFileSync(join(repo, path, 'index.js'), 'export {};\n');
	}
	return {repo, tree};
}

function run(repo: string, tree: string) {
	const done = spawnSync('node', [SCRIPT, repo, tree], {encoding: 'utf8'});
	return {status: done.status, output: `${done.stdout}${done.stderr}`};
}

describe('e2e-link-built.mjs', () => {
	it('links each declared path from the main checkout into the worktree', () => {
		const {repo, tree} = dirs({linkBuilt: ['common/dist', 'indexer/dist']}, [
			'common/dist',
			'indexer/dist',
		]);

		const {status, output} = run(repo, tree);

		expect(status, output).toBe(0);
		for (const path of ['common/dist', 'indexer/dist']) {
			expect(lstatSync(join(tree, path)).isSymbolicLink()).toBe(true);
			expect(realpathSync(join(tree, path))).toBe(
				realpathSync(join(repo, path)),
			);
		}
		expect(readFileSync(join(tree, 'common/dist/index.js'), 'utf8')).toContain(
			'export',
		);
	});

	it('fails naming a declared path the main checkout has not built, and links nothing', () => {
		const {repo, tree} = dirs({linkBuilt: ['common/dist', 'indexer/dist']}, [
			'common/dist',
		]);

		const {status, output} = run(repo, tree);

		expect(status).not.toBe(0);
		expect(output).toContain(join(repo, 'indexer/dist'));
		expect(output).toContain('is missing');
		expect(
			existsSync(join(tree, 'common')),
			'the list is checked in full before anything is linked',
		).toBe(false);
	});

	it('does nothing for a repo with no "e2e" field, which is the template', () => {
		const {repo, tree} = dirs(undefined, []);

		const {status, output} = run(repo, tree);

		expect(status, output).toBe(0);
		expect(output).toBe('');
	});

	it('refuses an entry outside the repo, and an absolute one', () => {
		for (const entry of ['../outside', '/etc', '.']) {
			const {repo, tree} = dirs({linkBuilt: [entry]}, []);
			const {status, output} = run(repo, tree);
			expect(status, `${entry} should be refused`).not.toBe(0);
			expect(output).toContain('a path inside the repo');
		}
	});

	it('refuses a path the worktree already has, which is tracked and not built', () => {
		const {repo, tree} = dirs({linkBuilt: ['common/dist']}, ['common/dist']);
		mkdirSync(join(tree, 'common/dist'), {recursive: true});

		const {status, output} = run(repo, tree);

		expect(status).not.toBe(0);
		expect(output).toContain('already exists in the worktree');
	});
});
