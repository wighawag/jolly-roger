#!/usr/bin/env node
/**
 * Is every shared file this node MODIFIES listed in `.offshoot-divergences`,
 * with its reason, and does every listed file still differ?
 *
 * ## The third question, after the other two
 *
 * A node of this tree carries its stem's files in one of three ways: byte for
 * byte, not at all, or modified. `.offshoot-omissions` records the second
 * (`check-omissions.mjs` keeps it true), `check-stem-drift.mjs` catches a
 * modification that is really the stem's OLD version, and this records the
 * third: every shared file the node changed on purpose, and why. Without it a
 * cascade reviewer meeting a conflict, or a clean merge into a file that
 * differs, cannot tell a decision from drift, and has to dig through history to
 * find out whether the node's side is worth keeping.
 *
 * It was stratagems' own test first (`web/test/offshoot-divergences.test.ts`,
 * 2026-11-15, its plan's step C), because only stratagems recorded its
 * divergences. Measured across the tree on 2026-11-16, no other node did, while
 * jolly-roger `main` modified 34 shared files, `with/local-signer` 48 more,
 * template-commit-reveal `main` 49 (29 of them explained nowhere). It moved here
 * so that there is one check for the tree, as `check-omissions.mjs` did before
 * it, for the same reason: a check copied into each repo has as many futures as
 * copies.
 *
 * ## What it reports
 *
 * A file is MODIFIED here when the stem commit last merged has it and its
 * content in this working tree differs (renames count as a deletion and an
 * addition, as everywhere in this tree). With several stems (an integration
 * branch, `"stem": [a, b]`), a file is modified only when it differs from EVERY
 * stem that has it: a file one stem brought is that stem's, not this node's.
 * The list itself (`.offshoot-divergences`) is per-node data and is never one.
 *
 * It fails on:
 *   - a modified file with no entry;
 *   - an entry whose file does not differ (the stem took the change, or the
 *     node took the stem's back, or it is not one of the stem's files at all):
 *     a reason that outlived its difference;
 *   - an entry with no reason, and a path listed twice.
 *
 * The working tree is compared, not HEAD, so an edit fails before it is
 * committed. Paths still in conflict are skipped: they are not resolved yet.
 *
 * ## The list, and how it cascades
 *
 * One file per line, its path then its reason: `<path>  <reason>`. `#` starts a
 * comment. A line `[<branch>]` starts a SECTION.
 *
 * An in-repo branch (`with/local-signer` over `main`) inherits its stem
 * branch's list by merge, exactly as `.offshoot-omissions` is inherited, and
 * adds its own entries below a `[<its branch>]` marker. Only the LAST section is
 * this node's and is checked here; the sections above it are its stems' entries,
 * checked at those stems, against THEIR stems, and kept so that the cascade
 * carries them without a conflict. A list with no marker is one section, the
 * node `main`'s. A child REPO never keeps its stem repo's entries: its list is
 * its own, as `.offshoot-omissions` says of omissions.
 *
 * A node that has not written a list carries its stem's, byte for byte, by
 * cascade. That is reported as "no list of its own" with exit code 2, and
 * nothing is checked: a list to write (step K3 of jolly-roger's plan
 * `docs/plans/template-tree-features.md` writes the rest), not a list that is
 * wrong. No list at all is the same answer. Every other answer is 0 (every
 * modified file listed) or 1.
 *
 * ## Which stem
 *
 * In this order, as `check-stem-drift.mjs` resolves it, with one source more:
 *
 *   1. refs on the command line (`node scripts/check-divergences.mjs stem/main`),
 *      several for a node with several stems; else the same in
 *      `OFFSHOOT_STEM_REFS` (space separated), which is how a node's suite is
 *      pointed at stems that are not yet where the config says (a preview
 *      branch, merged from preview branches);
 *   2. otherwise the node's stems in `fanout.config.json` on the `offshoot`
 *      branch (local first, then `origin/offshoot`, as offshoot-fanout reads
 *      it): the node is the branch named by the list's last marker, else
 *      `main`; an in-repo stem is that branch here (local or `origin`, the newer
 *      of the two), a cross-repo one `stem/<stemBranch>`.
 *
 * Each is compared at its merge base with HEAD, the stem commit last merged, so
 * fetching a stem changes nothing until its new commits are merged. During a
 * merge (`MERGE_HEAD`, which is how `apply-omissions.sh` calls it), MERGE_HEAD
 * stands in for the stem it is a newer version of, and the node's other stems
 * come from the config, so an integration branch merging one stem still
 * compares against the other.
 *
 * At the ROOT (`template-svelte`, `"stem": null`) there is nothing to compare
 * against and this refuses, as `check-omissions.mjs` and `check-stem-drift.mjs`
 * do; it lives there to be distributed, unchanged, to every node. With no ref,
 * no merge and no config it refuses too, rather than reporting a pass it has
 * not earned.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const LIST = ".offshoot-divergences";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const NC = "\x1b[0m";

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (allowFailure) return undefined;
    throw error;
  }
}

function refuse(message) {
  console.error(`${RED}✗ ${message}${NC}`);
  process.exit(1);
}

function notChecked(message) {
  console.log(`${YELLOW}- ${message}${NC}`);
  process.exit(2);
}

const top = git(["rev-parse", "--show-toplevel"], { allowFailure: true });
if (!top) refuse("not inside a git repository");
process.chdir(top);

if (!existsSync(LIST)) {
  notChecked(`no ${LIST} here, so there is nothing to check`);
}
const listText = readFileSync(LIST, "utf8");

/** The list's sections, each `{branch, entries: [{path, reason, line}]}`. */
function parse(text) {
  const sections = [{ branch: undefined, entries: [] }];
  text.split("\n").forEach((raw, index) => {
    const content = raw.replace(/#.*$/, "").trim();
    if (content.length === 0) return;
    const marker = /^\[([^\]]+)\]$/.exec(content);
    if (marker) {
      sections.push({ branch: marker[1].trim(), entries: [] });
      return;
    }
    const [path, ...rest] = content.split(/\s+/);
    sections
      .at(-1)
      .entries.push({ path, reason: rest.join(" "), line: index + 1 });
  });
  return sections;
}

const sections = parse(listText);
const own = sections.at(-1);
const node = own.branch ?? "main";
const inherited = sections.slice(0, -1).flatMap((section) => section.entries);

const head = git(["rev-parse", "HEAD"]);
const merging = git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], {
  allowFailure: true,
});

/** The node's stems as refs, from the config, or `{error}`. */
function stemsFromConfig() {
  const text =
    git(["show", "offshoot:fanout.config.json"], { allowFailure: true }) ??
    git(["show", "origin/offshoot:fanout.config.json"], { allowFailure: true });
  if (!text) {
    return {
      error:
        "no ref given, no merge in progress, and no `offshoot` branch (local or " +
        "origin) holding fanout.config.json, so there is nothing to compare " +
        "against. Pass the stem commits, e.g.\n" +
        "  git fetch stem main && node scripts/check-divergences.mjs FETCH_HEAD",
    };
  }
  const config = JSON.parse(text);
  const branches = config.branches ?? { main: {} };
  const entry = branches[node];
  if (!entry) {
    return {
      fatal:
        `${LIST} names the node \`${node}\` (its last \`[branch]\` marker, or ` +
        `\`main\` without one), and fanout.config.json lists no such branch ` +
        `(it lists ${Object.keys(branches).join(", ")}). A list that came from ` +
        `another repo by cascade is not this one's: write this node's own.`,
    };
  }
  if (entry.stem) {
    const stems = Array.isArray(entry.stem) ? entry.stem : [entry.stem];
    return {
      stems: stems.map((branch) => ({
        name: branch,
        candidates: [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`],
      })),
    };
  }
  if (config.stem === null || config.stem === undefined) {
    return {
      error:
        `the node \`${node}\` is a root of the tree ("stem": null), so there ` +
        "is nothing to compare against. A list cannot hold an entry here: " +
        "there is nothing above the root to differ FROM.",
    };
  }
  const branch = entry.stemBranch ?? "main";
  return {
    stems: [
      { name: `stem/${branch}`, candidates: [`refs/remotes/stem/${branch}`] },
    ],
  };
}

function isAncestor(a, b) {
  return (
    git(["merge-base", "--is-ancestor", a, b], { allowFailure: true }) !==
    undefined
  );
}

/** The stem commit last merged from a stem, the newer of its candidate refs. */
function baseOf(stem) {
  let best;
  for (const ref of stem.candidates) {
    if (
      !git(["rev-parse", "-q", "--verify", `${ref}^{commit}`], {
        allowFailure: true,
      })
    )
      continue;
    const base = git(["merge-base", "HEAD", ref], { allowFailure: true });
    if (!base) continue;
    if (!best || isAncestor(best.commit, base))
      best = { commit: base, how: ref.replace(/^refs\/(heads|remotes)\//, "") };
  }
  return best;
}

const given = process.argv.slice(2);
const fromEnv = (process.env.OFFSHOOT_STEM_REFS ?? "")
  .split(/\s+/)
  .filter((ref) => ref.length > 0);

let stems;
let configError;
if (given.length > 0 || fromEnv.length > 0) {
  stems = (given.length > 0 ? given : fromEnv).map((ref) => {
    const commit = git(["rev-parse", "--verify", `${ref}^{commit}`], {
      allowFailure: true,
    });
    if (!commit) refuse(`cannot resolve the ref you gave: ${ref}`);
    return { name: ref, candidates: [commit] };
  });
} else {
  const resolved = stemsFromConfig();
  if (resolved.fatal) refuse(resolved.fatal);
  if (resolved.error) configError = resolved.error;
  stems = resolved.stems ?? [];
}

const bases = [];
for (const stem of stems) {
  const base = baseOf(stem);
  if (!base) {
    const message =
      `${stem.name} is not here (or shares no history with HEAD): fetch it ` +
      `(git fetch stem, or git fetch origin), or pass the stem commits.`;
    if (merging) configError = message;
    else refuse(message);
    continue;
  }
  bases.push({
    commit: base.commit,
    how: given.length > 0 ? stem.name : base.how,
  });
}

let compared = bases;
if (merging) {
  // MERGE_HEAD is the newer version of the stem being merged: it replaces that
  // stem's last-merged commit. The others stay.
  compared = [
    { commit: merging, how: "MERGE_HEAD (a merge in progress)" },
    ...bases.filter((base) => !isAncestor(base.commit, merging)),
  ];
  if (configError) {
    console.log(
      `${YELLOW}  note: compared against MERGE_HEAD only, since ${configError}${NC}`,
    );
  }
} else if (compared.length === 0) {
  refuse(configError ?? "nothing to compare against");
}

for (const base of compared) {
  if (!merging && base.commit === head) {
    refuse(
      `${base.how} IS this commit (${head.slice(0, 8)}), so there is nothing ` +
        `to compare against. That is not a pass - check the ref.`,
    );
  }
}

// A NODE THAT HAS NOT WRITTEN A LIST carries its stem's by cascade.
for (const base of compared) {
  const theirs = git(["show", `${base.commit}:${LIST}`], {
    allowFailure: true,
  });
  if (theirs !== undefined && theirs === listText.trim()) {
    notChecked(
      `${LIST} is ${base.how.split(" ")[0]}'s byte for byte, so this node has ` +
        `no list of its own yet and nothing here is checked`,
    );
  }
}

function nulSplit(text) {
  return (text ?? "").split("\0").filter((part) => part.length > 0);
}

const unmerged = new Set(
  nulSplit(git(["ls-files", "-u", "-z"])).map((line) =>
    line.slice(line.indexOf("\t") + 1),
  ),
);

/** For one stem commit: the paths here that differ from it, and that it lacks. */
function against(commit) {
  const status = nulSplit(
    git(["diff", "--name-status", "--no-renames", "-z", commit]),
  );
  const modified = new Set();
  const added = new Set();
  for (let i = 0; i + 1 < status.length; i += 2) {
    const [kind, path] = [status[i][0], status[i + 1]];
    if (unmerged.has(path) || path === LIST) continue;
    if (kind === "M" || kind === "T") modified.add(path);
    else if (kind === "A") added.add(path);
  }
  return { modified, added };
}

const diffs = compared.map((base) => against(base.commit));
const candidates = new Set(diffs.flatMap((diff) => [...diff.modified]));
const divergent = [...candidates]
  .filter((path) =>
    diffs.every((diff) => diff.modified.has(path) || diff.added.has(path)),
  )
  .sort();

const problems = [];

const bare = [...inherited, ...own.entries].filter(
  (entry) => entry.reason.length === 0,
);
if (bare.length > 0) {
  problems.push([
    "these entries have no reason, and an unexplained entry is how a " +
      "divergence outlives the reason for it:",
    bare.map((entry) => `line ${entry.line}: ${entry.path}`),
  ]);
}

const seen = new Set();
const twice = own.entries.filter(
  (entry) => seen.has(entry.path) || !seen.add(entry.path),
);
if (twice.length > 0) {
  problems.push(["listed twice:", twice.map((entry) => entry.path)]);
}

const listed = new Set(own.entries.map((entry) => entry.path));
const unlisted = divergent.filter((path) => !listed.has(path));
if (unlisted.length > 0) {
  problems.push([
    `these differ from the stem's and are not in ${LIST}${own.branch ? ` (its [${own.branch}] section)` : ""}: ` +
      `list each with the reason it must differ, or take the stem's ` +
      `(git checkout <stem commit> -- <path>):`,
    unlisted,
  ]);
}

const differing = new Set(divergent);
const stale = [...listed].filter((path) => !differing.has(path)).sort();
if (stale.length > 0) {
  problems.push([
    `these are listed in ${LIST} but do not differ from the stem's, or are ` +
      `not one of its files: remove them from the list:`,
    stale,
  ]);
}

const against_ = compared
  .map((base) => `${base.commit.slice(0, 8)} (${base.how})`)
  .join(", ");

if (problems.length === 0) {
  // Says the COUNT, so a pass over nothing is visible as one.
  console.log(
    `${GREEN}✓ ${divergent.length} shared file(s) differ from ${against_}, ` +
      `each listed with its reason, for the node ${node}` +
      (inherited.length > 0
        ? ` (${inherited.length} inherited entries, its stems', checked there)`
        : "") +
      NC,
  );
  process.exit(0);
}

console.error(`${RED}✗ ${LIST} does not describe the node ${node}:${NC}`);
for (const [what, paths] of problems) {
  console.error(`  ${what}`);
  for (const path of paths) console.error(`    ${path}`);
}
console.error("");
console.error(`  Compared against ${against_}.`);
process.exit(1);
