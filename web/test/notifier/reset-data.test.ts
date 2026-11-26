// QA F20: `pnpm start` opens a new local chain each time, while the notifier's
// databases (`notifier/.data`) remembered the previous one, so after a restart
// the indexer and the trigger service were past blocks the new chain had not
// reached and no greeting was ever pushed. Each start now clears them first.
import {afterEach, describe, expect, it} from 'vitest';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {keepData, resetNotifierData} from '../../notifier/reset-data.mjs';

const dirs: string[] = [];
function dataDir(files: string[]) {
	const dir = mkdtempSync(path.join(tmpdir(), 'notifier-data-'));
	dirs.push(dir);
	for (const file of files) writeFileSync(path.join(dir, file), 'stale');
	return dir;
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true});
});

describe('the notifier data reset (pnpm start)', () => {
	it('removes every database and its SQLite sidecars, and nothing else', () => {
		const dir = dataDir([
			'greetings.db',
			'greetings.db-wal',
			'greetings.db-shm',
			'triggers.db',
			'triggers.db-journal',
			'push.db',
			'missiv.db',
			'notes.txt',
		]);
		const {kept, removed} = resetNotifierData(dir);
		expect(kept).toBe(false);
		expect(removed).toEqual([
			'greetings.db',
			'greetings.db-shm',
			'greetings.db-wal',
			'missiv.db',
			'push.db',
			'triggers.db',
			'triggers.db-journal',
		]);
		for (const file of removed)
			expect(existsSync(path.join(dir, file))).toBe(false);
		expect(existsSync(path.join(dir, 'notes.txt'))).toBe(true);
	});

	it('keeps everything with NOTIFIER_KEEP_DATA', () => {
		const dir = dataDir(['greetings.db', 'triggers.db']);
		expect(resetNotifierData(dir, {keep: true})).toEqual({
			kept: true,
			removed: [],
		});
		expect(existsSync(path.join(dir, 'greetings.db'))).toBe(true);
		expect(existsSync(path.join(dir, 'triggers.db'))).toBe(true);
	});

	it('is a no-op on a first start, with no data folder yet', () => {
		expect(
			resetNotifierData(path.join(tmpdir(), 'notifier-data-none-xyz')),
		).toEqual({
			kept: false,
			removed: [],
		});
	});

	it('reads NOTIFIER_KEEP_DATA as a flag', () => {
		expect(keepData(undefined)).toBe(false);
		expect(keepData('')).toBe(false);
		expect(keepData('0')).toBe(false);
		expect(keepData('false')).toBe(false);
		expect(keepData('1')).toBe(true);
		expect(keepData('true')).toBe(true);
	});

	it('runs once before the dev stack opens its panes, not in a pane', () => {
		const root = JSON.parse(
			readFileSync(
				fileURLToPath(new URL('../../../package.json', import.meta.url)),
				'utf8',
			),
		);
		// a live session is attached to (its chain is still running), a new one
		// is reset first
		expect(root.scripts.zellij).toMatch(
			/zellij-launcher a .*\|\| pnpm zellij:new$/,
		);
		expect(root.scripts['zellij:new']).toMatch(
			/^pnpm --filter \.\/web notifier:reset && expand-vars zellij -n dev\/zellij\.kdl /,
		);
		const web = JSON.parse(
			readFileSync(
				fileURLToPath(new URL('../../package.json', import.meta.url)),
				'utf8',
			),
		);
		expect(web.scripts['notifier:reset']).toBe('node notifier/reset-data.mjs');
		const layout = readFileSync(
			fileURLToPath(new URL('../../../dev/zellij.kdl', import.meta.url)),
			'utf8',
		);
		expect(layout).not.toMatch(/notifier:reset/);
	});
});
