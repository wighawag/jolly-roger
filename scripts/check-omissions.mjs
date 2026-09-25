#!/usr/bin/env node
/**
 * Does `.offshoot-omissions` still describe what this repo actually omits?
 *
 * ## The half the other two checks cannot do
 *
 * There are three guards around this file and they point in different
 * directions. `web/test/offshoot-omissions.test.ts` asserts that every LISTED
 * path is still absent, which catches a cascade that quietly reinstated one.
 * `scripts/apply-omissions.sh` re-drops them in one command. Neither can catch
 * the opposite and more likely mistake: **a path this repo deleted that nobody
 * ever listed.** That needs the stem, because "deliberately absent" and "never
 * existed here" look identical from inside one repo.
 *
 * ## Why it was written
 *
 * Because the absence of it was measured, across five repos, and every single
 * list was incomplete: jolly-roger listed 0 of 3, template-commit-reveal 0 of 17
 * (its file said "this template omits nothing"), reveal-or-die 4 of 52, bleeps 1
 * of 21, mandalas 2 of 24. The cost is exactly what this file's header predicts:
 * a cascade touches a deleted path, the list says there is nothing to look up,
 * and whoever is mid-merge has to work out from scratch whether the deletion was
 * deliberate. It happened, and the deletion turned out to be recorded in NO diff
 * at all - it lived in the resolution of an old merge - so recovering the intent
 * meant walking sixty commits asking `git cat-file -e`.
 *
 * A hand-maintained list of deletions decays for the same reason every such list
 * decays: the moment you delete something is the moment you are thinking about
 * something else.
 *
 * ## What counts as an omission, which is the one subtle part
 *
 * A path in the stem that is absent here is NOT automatically an omission. It
 * might be something the stem ADDED since the last merge, which will simply
 * arrive on the next one. So the test is three-way: present in the stem, absent
 * here, AND present at the merge base. That means this repo once had it and
 * dropped it, which is the decision worth recording.
 *
 * ## Which stem commit
 *
 * **`MERGE_HEAD` when a merge is in progress**, and that is the case this exists
 * for: during a cascade the commit being merged IS the stem commit, so there is
 * nothing to configure, no remote to fetch and no branch name to guess wrong.
 * `apply-omissions.sh` calls it exactly then.
 *
 * Otherwise a ref may be given on the command line
 * (`node scripts/check-omissions.mjs stem/main`). With neither, this FAILS rather
 * than passing: a check that answers "nothing to report" because it could not
 * find anything to compare against is worse than no check, and this tree has
 * written down twice that a rule nothing enforces is a wish.
 *
 * In a WORKTREE `.git` is a file, so `MERGE_HEAD` is found with
 * `git rev-parse -q --verify`, never by testing for `.git/MERGE_HEAD`.
 *
 * ## What it reads as "here"
 *
 * `git ls-files`, not the HEAD tree, because during a merge HEAD is still the
 * pre-merge commit while the index holds the resolution. Reading HEAD would
 * report every path the merge had just reinstated as still absent, which is the
 * wrong answer at the only moment anyone runs this.
 */
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';

const LIST = '.offshoot-omissions';

function git(args, {allowFailure = false} = {}) {
	try {
		return execFileSync('git', args, {encoding: 'utf8'}).trim();
	} catch (error) {
		if (allowFailure) return undefined;
		throw error;
	}
}

function lines(text) {
	return (text ?? '')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/** The stem commit to compare against, or a reason there is none. */
function resolveStem() {
	const given = process.argv[2];
	if (given) {
		const resolved = git(['rev-parse', '--verify', given], {
			allowFailure: true,
		});
		if (!resolved) return {error: `cannot resolve the ref you gave: ${given}`};
		return {commit: resolved, how: `the ref you gave (${given})`};
	}
	// A merge in progress: MERGE_HEAD IS the stem commit. `rev-parse`, because in
	// a worktree `.git` is a file and `test -f .git/MERGE_HEAD` is silently false.
	const merging = git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
		allowFailure: true,
	});
	if (merging) return {commit: merging, how: 'MERGE_HEAD (a merge in progress)'};
	return {
		error:
			'no merge in progress and no ref given, so there is nothing to compare ' +
			'against. Pass the stem commit you are checking against, e.g.\n' +
			'  git fetch stem main && node scripts/check-omissions.mjs FETCH_HEAD',
	};
}

/** Paths listed as deliberately omitted, with the comment lines stripped. */
function listed() {
	if (!existsSync(LIST)) {
		console.error(`\x1b[31m✗ no ${LIST} at the repo root\x1b[0m`);
		process.exit(1);
	}
	return lines(
		readFileSync(LIST, 'utf8')
			.split('\n')
			.map((line) => line.replace(/#.*$/, ''))
			.join('\n'),
	);
}

const stem = resolveStem();
if (stem.error) {
	console.error(`\x1b[31m✗ ${stem.error}\x1b[0m`);
	process.exit(1);
}

const base = git(['merge-base', 'HEAD', stem.commit], {allowFailure: true});
if (!base) {
	console.error(
		`\x1b[31m✗ no merge base between HEAD and ${stem.commit.slice(0, 8)}, so ` +
			`these two histories are unrelated and nothing here can be an ` +
			`omission FROM it\x1b[0m`,
	);
	process.exit(1);
}

const inStem = new Set(
	lines(git(['ls-tree', '-r', '--name-only', stem.commit])),
);
const atBase = new Set(lines(git(['ls-tree', '-r', '--name-only', base])));
const here = new Set(lines(git(['ls-files'])));

// Present in the stem, gone from here, and here once: a deletion this repo made.
const deletedHere = [...inStem]
	.filter((path) => !here.has(path) && atBase.has(path))
	.sort();

const omitted = listed();
const covers = (path) =>
	omitted.some((entry) => path === entry || path.startsWith(`${entry}/`));
const unlisted = deletedHere.filter((path) => !covers(path));

// GUARDS THE GUARD, and the first version of this got it wrong in a way worth
// recording, because the wrong version fired on four correct runs.
//
// It refused to pass when the list was non-empty and NOTHING came back as
// deleted, on the grounds that a list of omissions with no omissions found means
// the comparison is broken. That is true when the ref is wrong, and it is also
// the ordinary, correct state of a SIBLING BRANCH: `with/pixi-js` checked against
// `main` drops nothing that `main` does not already drop, because the parent's
// deletions are already in the branch - so the paths are absent from BOTH sides,
// which means they are not in the stem tree and are rightly not reported. Zero is
// the honest answer there, and the check called it a failure.
//
// The two things that ARE unambiguous get checked instead: a stem commit that IS
// this commit (comparing a tree with itself, which is what a mistyped ref usually
// produces) and an empty stem tree. Neither has a legitimate reading.
if (stem.commit === git(['rev-parse', 'HEAD'])) {
	console.error(
		`\x1b[31m✗ ${stem.commit.slice(0, 8)} IS this commit, so there is nothing to ` +
			`compare against. That is not a pass - check the ref.\x1b[0m`,
	);
	process.exit(1);
}
if (inStem.size === 0) {
	console.error(
		`\x1b[31m✗ ${stem.commit.slice(0, 8)} has no tracked files at all, so every ` +
			`answer below would be vacuous - check the ref.\x1b[0m`,
	);
	process.exit(1);
}

if (unlisted.length === 0) {
	// Says the COUNT, so "covers all 0" is visible rather than looking like a
	// thorough pass. Zero is the right answer for a sibling branch (see above) and
	// the wrong answer if you meant to check against the repo's own stem, and only
	// the number tells the two apart.
	console.log(
		`\x1b[32m✓ .offshoot-omissions covers all ${deletedHere.length} path(s) ` +
			`this repo drops from ${stem.commit.slice(0, 8)}\x1b[0m`,
	);
	process.exit(0);
}

console.error(
	`\x1b[31m✗ ${unlisted.length} path(s) are absent here, were inherited, and ` +
		`are not in ${LIST}:\x1b[0m`,
);
for (const path of unlisted) console.error(`    ${path}`);
console.error('');
console.error(
	`  Compared against ${stem.commit.slice(0, 8)}, from ${stem.how}.\n` +
		`  Each of these is a deletion nobody wrote down, so the next cascade that\n` +
		`  touches one stops with a modify/delete conflict and no way to look up\n` +
		`  whether it was deliberate. Add it to ${LIST} WITH A REASON - the next\n` +
		`  person's question is never "which file", it is "why" - or restore it.\n` +
		`  A directory entry covers everything under it, which is usually what you\n` +
		`  want: a game's whole directory rather than forty files from it.`,
);
process.exit(1);
