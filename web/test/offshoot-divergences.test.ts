import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';

/**
 * Every shared file this node modifies is listed, with its reason, in
 * `.offshoot-divergences`, and every listed file is modified.
 *
 * THE CHECK IS `scripts/check-divergences.mjs`, the tree's one copy, and its
 * header says what it compares and why; this runs it on this repo, against the
 * stems this node's `fanout.config.json` names (or `OFFSHOOT_STEM_REFS`, for a
 * preview branch whose stems are not yet where the config says). It began as
 * stratagems' own test, whose logic moved into the script so that every node
 * runs the same thing.
 *
 * WHERE IT CHECKS NOTHING, AND SAYS SO. A node with no list, or whose list is
 * its stem's byte for byte (it has not written its own yet, and carries its
 * stem's by cascade), is SKIPPED, visibly, with the script's reason; the root
 * has no list. Everywhere else it fails, rather than skipping, when it cannot
 * compare: a guard that passes when it cannot look is the guard that stopped
 * looking without anyone noticing. A node keeping a list needs its stems here:
 * the `stem` remote fetched for a cross-repo stem, the stem branch (local or
 * `origin`) for an in-repo one.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('offshoot divergences', () => {
	it('lists exactly the shared files this node modifies, each with its reason', (context) => {
		const done = spawnSync('node', [`${ROOT}scripts/check-divergences.mjs`], {
			cwd: ROOT,
			encoding: 'utf8',
		});
		const output = `${done.stdout}${done.stderr}`;
		if (done.status === 2) {
			// The script's reason, without its terminal colours.
			context.skip(output.replace(/\x1b\[[0-9;]*m/g, '').trim());
			return;
		}
		expect(done.status, output).toBe(0);
	});
});
