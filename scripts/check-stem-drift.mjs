#!/usr/bin/env node
/**
 * Is any file this repo shares with its stem left at an OLD version of the
 * stem's?
 *
 * ## The mistake this catches, which nothing else in the tree sees
 *
 * A cascade conflicts on a file the descendant also touched, and the conflict is
 * resolved "ours": the descendant's side is kept whole. When the descendant's
 * side was its own edit, that is a decision and costs one conflict per cascade.
 * When the descendant's side was simply the stem's PREVIOUS version (the
 * descendant never meant to own the file, a merge left it behind, and the next
 * one kept it that way), it is a defect with no symptom: the file is a perfectly
 * good file, just the stem's from some weeks ago, so the tree builds and every
 * test passes. Every later change the stem makes to it conflicts or is dropped,
 * and the descendant goes on missing whatever the stem added since.
 *
 * Measured in stratagems on 2026-11-15 (its step C, against
 * template-commit-reveal `with/fuzd-pixi-indexer`): three files were byte for
 * byte a blob the stem's history holds, each from a cascade resolved "ours".
 * One was the game menu, which had gone two weeks without the "Tables" entry the
 * stem added, so a whole mode was reachable from the navbar only. Nobody had
 * noticed, because nothing could fail.
 *
 * ## The test, which is exact rather than a heuristic
 *
 * For every path tracked both here and in the stem commit whose content differs,
 * this asks whether the content here is a blob the stem's history held AT THAT
 * PATH. If it is, the descendant has no version of its own: it has an old one of
 * the stem's. A file the descendant edited is a blob the stem never had, so it
 * passes, however far it has diverged; that is a divergence, which is a
 * decision, and deciding it is not this script's business.
 *
 * AND IT DIFFERS FROM WHAT THE LAST MERGE BROUGHT. A repo merely BEHIND its
 * stem holds, for every file the stem changed since, the blob the last merge
 * brought, which is in the stem's history too; that is not drift, the next
 * merge brings the new version cleanly. So the base is the merge base (or, in a
 * merge, MERGE_HEAD, which committing the merge makes the base), and a file
 * still at the base's version is counted as behind rather than reported.
 *
 * There is no exemption list, on purpose. Keeping an old version of a stem's
 * file is never the intent anyone has; what they mean is "this file is mine
 * now", and the honest form of that is an edit that says so, after which the
 * file passes here and is catalogued wherever the repo catalogues its own
 * divergences.
 *
 * ## The stem commit, and "here"
 *
 * As `check-omissions.mjs` resolves them, for the same reasons: `MERGE_HEAD`
 * when a merge is in progress (during a cascade the commit being merged IS the
 * stem commit, and that is the moment a resolution "ours" is made), otherwise a
 * ref given on the command line (`node scripts/check-stem-drift.mjs stem/main`),
 * and with neither it FAILS rather than reporting a pass it has not earned.
 * "Here" is the INDEX (`git ls-files -s`), not HEAD: during a merge HEAD is the
 * pre-merge commit while the index holds the resolution. A path still in
 * conflict (stages 1 to 3) is not resolved yet and is skipped.
 *
 * At the ROOT (`template-svelte`, `"stem": null`) there is nothing to compare
 * against and this refuses, as `check-omissions.mjs` does; it lives there to be
 * distributed, unchanged, to every node, which is the reason the tree's shared
 * machinery lives at the root at all (see that file's header).
 *
 * ## Which blobs count as "the stem's history"
 *
 * Every blob the path held in a commit reachable from the stem commit, read from
 * `git log --raw -m` over those paths only: both sides of every change, merges
 * diffed against each parent so a blob that only a merge resolution produced is
 * seen too. Reachable from the stem, and from nowhere else: the descendant's own
 * commits are not in the stem's history, so its own versions are never mistaken
 * for the stem's. One case reads as drift and is: a change the stem took FROM
 * the descendant (a backport) and has since moved on from.
 */
import {execFileSync} from 'node:child_process';

function git(args, {allowFailure = false} = {}) {
	try {
		return execFileSync('git', args, {
			encoding: 'utf8',
			maxBuffer: 256 * 1024 * 1024,
		}).trim();
	} catch (error) {
		if (allowFailure) return undefined;
		throw error;
	}
}

function lines(text) {
	return (text ?? '').split('\n').filter((line) => line.length > 0);
}

/** The stem commit to compare against, or a reason there is none. */
function resolveStem() {
	const given = process.argv[2];
	if (given) {
		const resolved = git(['rev-parse', '--verify', `${given}^{commit}`], {
			allowFailure: true,
		});
		if (!resolved) return {error: `cannot resolve the ref you gave: ${given}`};
		return {commit: resolved, how: `the ref you gave (${given})`};
	}
	const merging = git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
		allowFailure: true,
	});
	if (merging)
		return {
			commit: merging,
			how: 'MERGE_HEAD (a merge in progress)',
			merging: true,
		};
	return {
		error:
			'no merge in progress and no ref given, so there is nothing to compare ' +
			'against. Pass the stem commit you are checking against, e.g.\n' +
			'  git fetch stem main && node scripts/check-stem-drift.mjs FETCH_HEAD',
	};
}

const stem = resolveStem();
if (stem.error) {
	console.error(`\x1b[31m✗ ${stem.error}\x1b[0m`);
	process.exit(1);
}
if (stem.commit === git(['rev-parse', 'HEAD'])) {
	console.error(
		`\x1b[31m✗ ${stem.commit.slice(0, 8)} IS this commit, so there is nothing to ` +
			`compare against. That is not a pass - check the ref.\x1b[0m`,
	);
	process.exit(1);
}

/** path -> blob in a commit's tree (`<mode> <type> <blob>\t<path>`). */
function treeBlobs(commit) {
	const blobs = new Map();
	for (const line of lines(git(['ls-tree', '-r', '--full-tree', commit]))) {
		const tab = line.indexOf('\t');
		const [, type, blob] = line.slice(0, tab).split(' ');
		if (type === 'blob') blobs.set(line.slice(tab + 1), blob);
	}
	return blobs;
}

/** path -> blob from the index, skipping anything still in conflict. */
function indexBlobs() {
	const blobs = new Map();
	const conflicted = new Set();
	for (const line of lines(git(['ls-files', '-s', '--full-name']))) {
		const tab = line.indexOf('\t');
		const [, blob, stage] = line.slice(0, tab).split(' ');
		const path = line.slice(tab + 1);
		if (stage === '0') blobs.set(path, blob);
		else conflicted.add(path);
	}
	for (const path of conflicted) blobs.delete(path);
	return blobs;
}

const inStem = treeBlobs(stem.commit);
if (inStem.size === 0) {
	console.error(
		`\x1b[31m✗ ${stem.commit.slice(0, 8)} has no tracked files at all, so every ` +
			`answer below would be vacuous - check the ref.\x1b[0m`,
	);
	process.exit(1);
}
const here = indexBlobs();

// THE BASE: what this repo last took from the stem. During a merge it is
// MERGE_HEAD itself, because committing the merge makes it so, and a resolution
// "ours" is exactly a file kept at an older version than that. Outside a merge
// it is the merge base, so a repo that is merely BEHIND its stem (the stem
// changed a file since the last merge, and this repo never touched it) is not
// reported: that file is still what the last merge brought, and the next merge
// brings the new one cleanly. Measured the day this was written: checked
// against a stem one cascade ahead, the first version reported every file the
// cascade had changed as drift.
let baseCommit = stem.commit;
if (!stem.merging) {
	baseCommit = git(['merge-base', 'HEAD', stem.commit], {allowFailure: true});
	if (!baseCommit) {
		console.error(
			`\x1b[31m✗ no merge base between HEAD and ${stem.commit.slice(0, 8)}, so ` +
				`these two histories are unrelated and nothing here can have been ` +
				`left behind by a merge FROM it\x1b[0m`,
		);
		process.exit(1);
	}
}
const atBase = baseCommit === stem.commit ? inStem : treeBlobs(baseCommit);

const differing = [...here]
	.filter(([path, blob]) => inStem.has(path) && inStem.get(path) !== blob)
	.map(([path]) => path)
	.sort();
const behind = new Set(
	differing.filter((path) => atBase.get(path) === here.get(path)),
);
const candidates = differing.filter((path) => !behind.has(path));

/**
 * For each path, the blobs the stem's history held there, each with the newest
 * stem commit that replaced it (the moment the stem moved on from it).
 */
function stemHistory(paths) {
	const history = new Map(paths.map((path) => [path, new Map()]));
	if (paths.length === 0) return history;
	// Chunked, so a repo that differs on many files never builds an argument
	// list the OS refuses.
	for (let i = 0; i < paths.length; i += 200) {
		const chunk = paths.slice(i, i + 200);
		const log = git([
			'log',
			'--raw',
			'--no-abbrev',
			'--no-renames',
			'-m',
			'--format=commit %H %P',
			stem.commit,
			'--',
			...chunk,
		]);
		let commit;
		let merge = false;
		for (const line of lines(log)) {
			if (line.startsWith('commit ')) {
				const [hash, ...parents] = line.slice('commit '.length).split(' ');
				commit = hash;
				merge = parents.length > 1;
				continue;
			}
			if (!line.startsWith(':')) continue;
			const tab = line.indexOf('\t');
			const [, , before, after] = line.slice(1, tab).split(' ');
			const seen = history.get(line.slice(tab + 1));
			if (!seen) continue;
			// Newest first: the first commit seen replacing a blob is the last
			// time the stem had it. A merge "replaces" a blob against whichever
			// parent still had it, so a commit of the stem's own is preferred:
			// that is the change the descendant missed.
			if (!/^0+$/.test(before)) {
				const known = seen.get(before);
				if (!known || (known.merge && !merge))
					seen.set(before, {commit, merge});
			}
			if (!/^0+$/.test(after) && !seen.has(after)) seen.set(after, undefined);
		}
	}
	return history;
}

const history = stemHistory(candidates);
const drifted = candidates
	.filter((path) => history.get(path).has(here.get(path)))
	.map((path) => ({
		path,
		until: history.get(path).get(here.get(path))?.commit,
	}));

if (drifted.length === 0) {
	// Says the COUNT, so a pass over nothing is visible as one.
	console.log(
		`\x1b[32m✓ ${differing.length} shared file(s) differ from ` +
			`${stem.commit.slice(0, 8)}, and none is an old version of the stem's` +
			(behind.size > 0
				? ` (${behind.size} of them only behind it, as the last merge left them)`
				: '') +
			`\x1b[0m`,
	);
	process.exit(0);
}

console.error(
	`\x1b[31m✗ ${drifted.length} shared file(s) are an OLD version of the stem's, ` +
		`not a version of this repo's own:\x1b[0m`,
);
for (const {path, until} of drifted) {
	const when = until
		? `the stem's until ${until.slice(0, 8)} (${git(['log', '-1', '--format=%s', until])})`
		: `a version the stem's history holds`;
	console.error(`    ${path}\n        ${when}`);
}
console.error('');
console.error(
	`  Compared against ${stem.commit.slice(0, 8)}, from ${stem.how}.\n` +
		`  Each of these was most likely left behind by a merge resolved "ours".\n` +
		`  Take the stem's version (git checkout ${stem.commit.slice(0, 8)} -- <path>),\n` +
		`  or, if the file really is this repo's now, make the edit that says so.`,
);
process.exit(1);
