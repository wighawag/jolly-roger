// Clears the notifier's databases before the dev stack starts (QA F20).
//
//   node notifier/reset-data.mjs   (pnpm notifier:reset; `pnpm start` runs it)
//
// `pnpm start` opens a NEW local chain every time (the same chain id and, by
// deterministic deploys, the same contract addresses), while the services kept
// what they learnt of the previous one in `notifier/.data`: the indexer's
// `greetings.db` and the trigger service's `triggers.db` then believe they are
// past blocks the new chain has not reached, so no greeting is ever pushed,
// and the push server's `push.db` (and missiv's `missiv.db`, with/messaging)
// hold devices, rooms and messages of a chain that is gone. Each start is
// therefore fresh: the devices press "Notify me" again.
//
// It runs ONCE, before zellij opens the panes (the root's `zellij:new`), not in
// a pane: the services share the folder and start together, so a clear by the
// first of them would race the others' opening of their databases.
//
// NOTIFIER_KEEP_DATA=1 keeps everything. Only the databases are removed (any
// `*.db` and its SQLite sidecars), so a NOTIFIER_DATA pointing somewhere else
// never loses anything but the services' own files. The keys
// (`notifier/.env.local`) are not data and are kept.
import {existsSync, readdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const DATABASE = /\.db(-wal|-shm|-journal)?$/;

/**
 * Removes the notifier's databases from `dir`.
 * @param {string} dir the services' data folder (NOTIFIER_DATA)
 * @param {{keep?: boolean}} [options] keep: leave everything (NOTIFIER_KEEP_DATA)
 * @returns {{kept: boolean, removed: string[]}} what was removed, by name
 */
export function resetNotifierData(dir, options = {}) {
	if (options.keep) return {kept: true, removed: []};
	if (!existsSync(dir)) return {kept: false, removed: []};
	const removed = [];
	for (const name of readdirSync(dir).sort()) {
		if (!DATABASE.test(name)) continue;
		rmSync(path.join(dir, name), {force: true});
		removed.push(name);
	}
	return {kept: false, removed};
}

/**
 * NOTIFIER_KEEP_DATA: set and neither empty, `0` nor `false`.
 * @param {string | undefined} value
 */
export function keepData(value) {
	return !!value && !['0', 'false'].includes(value.trim().toLowerCase());
}

const here = path.dirname(fileURLToPath(import.meta.url));
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const dir = process.env.NOTIFIER_DATA ?? path.join(here, '.data');
	const shown = path.relative(process.cwd(), dir) || dir;
	const {kept, removed} = resetNotifierData(dir, {
		keep: keepData(process.env.NOTIFIER_KEEP_DATA),
	});
	if (kept) {
		console.log(`notifier: NOTIFIER_KEEP_DATA is set, ${shown} kept`);
	} else if (removed.length > 0) {
		console.log(
			`notifier: a new chain, so a fresh start: removed ${removed.join(', ')} from ${shown} (devices press Notify me again; NOTIFIER_KEEP_DATA=1 keeps them)`,
		);
	}
}
