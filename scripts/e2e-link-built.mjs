#!/usr/bin/env node
/**
 * Link what an app BUILDS in its main checkout into the e2e worktree.
 *
 *   node scripts/e2e-link-built.mjs <main checkout> <e2e worktree>
 *
 * Called by `scripts/run-e2e-tests.sh` once the worktree's dependencies are
 * linked. It reads `"e2e": {"linkBuilt": [...]}` from the main checkout's root
 * `package.json` and, for each path, links `<main>/<path>` to
 * `<worktree>/<path>`.
 *
 * ## Why an app needs it
 *
 * The run happens in a fresh git worktree (the script's header says why), so it
 * has the tracked files and nothing else. What `pnpm install` generates and git
 * ignores is absent there: the template's own case is handled by the script
 * (the PWA icons, the dependencies, the contracts package built from the
 * worktree's compile), but an app can add workspace packages of its own whose
 * BUILD the app imports. stratagems is the case that made this a hook: its web
 * imports `common/` and its indexer, both built into gitignored `dist`
 * directories by its `prepare`, independent of any deployment. Its copy of the
 * script carried a hunk linking the two, and that hunk conflicted with every
 * cascade that touched the script.
 *
 * ## Why a declared list, and not every package's `dist` by convention
 *
 * A package that must build IN the worktree (the contracts package, whose
 * `dist` has to come from the artifacts the run just compiled) would be
 * silently replaced by the main checkout's stale build: a contract change
 * that was only compiled there would pass a suite it should fail. So nothing is
 * linked unless the app names it, the same way the LAN build reads only what
 * the `"lan"` field says.
 *
 * ## What it refuses
 *
 * A path that is missing in the main checkout FAILS THE RUN, naming it: the
 * build would otherwise fail much later, on an import, inside the worktree,
 * which reads like a broken app rather than a checkout that never ran
 * `pnpm i`. A path that already exists in the worktree is refused too (it is
 * tracked, so it is not a build output and linking over it would hide the
 * tracked file). An entry is a plain relative path inside the repo: no
 * absolute path, no `..`, checked before anything is linked, so a bad list
 * links nothing.
 */
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	symlinkSync,
} from 'node:fs';
import {dirname, isAbsolute, join, normalize, sep} from 'node:path';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const NC = '\x1b[0m';

function fail(message) {
	console.error(`${RED}✗ ${message}${NC}`);
	process.exit(1);
}

const [repo, worktree] = process.argv.slice(2);
if (!repo || !worktree) {
	fail('usage: e2e-link-built.mjs <main checkout> <e2e worktree>');
}

const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const declared = manifest.e2e?.linkBuilt ?? [];
if (!Array.isArray(declared)) {
	fail('package.json\'s "e2e.linkBuilt" must be an array of paths');
}

// Checked in full before anything is linked, so a bad entry links nothing.
const paths = declared.map((entry) => {
	if (typeof entry !== 'string' || entry.trim() === '') {
		fail(`"e2e.linkBuilt" holds ${JSON.stringify(entry)}, which is not a path`);
	}
	const path = normalize(entry).replace(/[/\\]+$/, '');
	if (
		isAbsolute(entry) ||
		path === '.' ||
		path === '..' ||
		path.startsWith(`..${sep}`)
	) {
		fail(
			`"e2e.linkBuilt" names ${entry}, and an entry is a path inside the repo`,
		);
	}
	if (!existsSync(join(repo, path))) {
		fail(
			`${join(repo, path)} is missing, and package.json's "e2e.linkBuilt" ` +
				`says the app needs it. Build it in the main checkout first (pnpm i).`,
		);
	}
	const target = join(worktree, path);
	let present = false;
	try {
		lstatSync(target);
		present = true;
	} catch {
		// absent, as a build output should be
	}
	if (present) {
		fail(
			`${target} already exists in the worktree, so it is tracked and not a ` +
				`build output; take it out of "e2e.linkBuilt"`,
		);
	}
	return path;
});

for (const path of paths) {
	const target = join(worktree, path);
	mkdirSync(dirname(target), {recursive: true});
	symlinkSync(join(repo, path), target);
}
if (paths.length > 0) {
	console.log(
		`${GREEN}  Linked what package.json's "e2e.linkBuilt" names: ` +
			`${paths.join(', ')}${NC}`,
	);
}
