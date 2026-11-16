import {cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {afterEach, describe, expect, it} from 'vitest';

/**
 * The contracts' type-check (`tsc && tsc -p test/js`) compiles `generated/`
 * only through its two indexes, never the whole folder.
 *
 * WHY. `generated/` is written by hardhat-deploy on every compile and never
 * cleaned, so it keeps a file from an older layout (`generated/artifacts.ts`)
 * or from a contract that was removed. An `include` naming the folder compiled
 * those too, and a stale one failed `tsc` (TS7056, measured in stratagems on a
 * plain `pnpm i`, fixed there in df641fc8 and brought here, its home, since
 * every node with contracts inherited the trap). Naming the two indexes is
 * enough: tsc follows their imports to every file still in use.
 *
 * IT ASKS TYPESCRIPT ITSELF which files each shipped config compiles, against a
 * scratch copy of `contracts/` holding the two indexes and two stray files, so
 * what is asserted is the configs that ship rather than a reading of them.
 */
const CONTRACTS = fileURLToPath(new URL('../../contracts/', import.meta.url));

const CONFIGS = ['tsconfig.json', 'test/js/tsconfig.json'];
const INDEXES = ['generated/abis/index.ts', 'generated/artifacts/index.ts'];
const STRAYS = [
	// The layout before `artifacts/` was a folder.
	'generated/artifacts.ts',
	// A contract that was removed: its index no longer imports it.
	'generated/abis/RemovedContract.ts',
];

const made: string[] = [];

afterEach(() => {
	while (made.length > 0) {
		const dir = made.pop();
		if (dir) rmSync(dir, {recursive: true, force: true});
	}
});

function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), 'contracts-tsconfig-'));
	made.push(dir);
	for (const config of CONFIGS) {
		mkdirSync(dirname(join(dir, config)), {recursive: true});
		cpSync(join(CONTRACTS, config), join(dir, config));
	}
	for (const file of [...INDEXES, ...STRAYS]) {
		mkdirSync(dirname(join(dir, file)), {recursive: true});
		writeFileSync(join(dir, file), 'export {};\n');
	}
	return dir;
}

/** The files tsc compiles for this config, relative to the scratch root. */
function compiled(root: string, config: string): string[] {
	const path = join(root, config);
	const read = ts.readConfigFile(path, ts.sys.readFile);
	if (read.error) throw new Error(`cannot read ${config}`);
	const parsed = ts.parseJsonConfigFileContent(
		read.config,
		ts.sys,
		dirname(path),
		undefined,
		path,
	);
	return parsed.fileNames.map((file) => relative(root, file));
}

describe('contracts tsconfig', () => {
	for (const config of CONFIGS) {
		it(`${config} leaves a stray file in generated/ out`, () => {
			const files = compiled(scratch(), config);
			for (const stray of STRAYS) expect(files).not.toContain(stray);
		});
	}

	it('tsconfig.json still compiles generated/ through its two indexes', () => {
		const files = compiled(scratch(), 'tsconfig.json');
		for (const index of INDEXES) expect(files).toContain(index);
	});
});
