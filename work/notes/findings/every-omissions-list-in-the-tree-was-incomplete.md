---
title: Every omissions list in the tree was incomplete, because nothing could ask the only question that matters
type: finding
status: FIXED 2026-09-25 (guard here, lists in all five repos)
spotted: 2026-09-25
relates-to: scripts/check-omissions.mjs, .offshoot-omissions, web/test/offshoot-omissions.test.ts
---

# Two guards pointing the same way, and the other direction unguarded

`.offshoot-omissions` records what a descendant deliberately does NOT carry from its stem, so that the modify/delete conflict a deletion eventually causes is a lookup instead of an excavation. It had two guards. `web/test/offshoot-omissions.test.ts` asserts every LISTED path is still absent; `scripts/apply-omissions.sh` re-drops them in one command. **Both start from the list.** Neither can see the opposite and far more likely mistake: a path this repo deleted that nobody ever wrote down.

Nothing inside a single repo can see it, either, and that is the whole reason the gap survived: **"deliberately absent" and "never existed here" are the same thing from the inside.** Telling them apart needs the stem.

## Measured, in five repos, before anything was written

| repo | drops | listed | 
| --- | --- | --- |
| jolly-roger | 3 | 0 |
| template-commit-reveal | 17 | 2 |
| reveal-or-die | 52 | 4 |
| bleeps | 21 | 1 |
| mandalas | 24 | 2 |

Every one. The two that had anything at all had it because somebody was burnt once and wrote down only the file that burnt them.

And the price had already been paid: a cascade stopped on `offline-demo/+page.svelte` in template-commit-reveal, whose list said in so many words that there was nothing to look up ("this template omits nothing - it is where the files come from", in a repo that omits seventeen paths). Recovering the intent took a walk through sixty commits with `git cat-file -e`, because **the deletion appears in no diff**: it lived in the resolution of an old stem merge, where `git show --stat <merge> -- <path>` prints nothing at all.

## What counts as an omission, which is the one subtle part

A path in the stem that is absent here is not automatically an omission - it may be something the stem ADDED since the last merge, arriving on the next one. So the test is three-way: **present in the stem, absent here, and present at the merge base.** That last clause is what makes it a decision somebody took rather than work that has not arrived.

## The guard, and the two things it had to get right

`scripts/check-omissions.mjs`.

**Which stem commit.** `MERGE_HEAD` when a merge is in progress, which is the case it exists for: during a cascade the commit being merged IS the stem commit, so there is nothing to configure, no remote to fetch and no branch name to guess wrong. `apply-omissions.sh` calls it exactly then, beside the dangling-import check and for the same stated reason - that is the moment the mistake is made. Otherwise a ref on the command line, and with neither it FAILS rather than passing.

**Not crying wolf.** The first version refused to pass when the list was non-empty and nothing came back as deleted, reasoning that a list of omissions with none found means a broken comparison. That is true of a wrong ref and it is also the ordinary, correct state of a SIBLING BRANCH: `with/pixi-js` against `main` drops nothing `main` does not already drop, so those paths are absent from both sides, are therefore not in the stem tree, and are rightly not reported. It fired on four correct runs before being replaced by the two conditions with no legitimate reading - a stem commit that IS this commit, and an empty stem tree. **A guard-the-guard rule that cries wolf teaches people to pass a flag, which is how it stops guarding anything.**

## What the lists gained, beyond being complete

Writing eighty-odd reasons turned up things the audit was not looking for, which is the second argument for doing it at all:

- **A stale script.** This repo deleted `web/static/icon.png` and left the stem's `generate-pwa-icons-and-tags` behind, spelled `pwag static/icon.png`, so running it fails on a missing file. `prepare` was re-pointed at the svg script and the old one was never removed.
- **Prose and data disagreeing.** reveal-or-die listed `web/test/lib/placement/advance.test.ts` under a comment declaring it stood for the whole CLASS of such files. The entry named one file, so the other ten were unlisted. It is the directory now.
- **Three coverage gaps that were being read as replacements**, now named as gaps in the lists that hold them: no gas-budget contract suite in reveal-or-die (and by ADR-0003 that figure is per-repo, so it cannot be inherited); nothing exercising the active identity's behaviour there either, since `identity-boundary.test.ts` is structural; and in mandalas, `contracts.e2e.ts`, `hydration.e2e.ts` and `in-flight-transactions.e2e.ts` were deleted with the demo suites although none of the three is demo-specific.
- **One entry that admits ignorance.** bleeps deleted `contracts/scripts/tsconfig.json`, and `contracts/tsconfig.json` covers only `deploy`, `generated` and `hardhat.config.ts` - so its own `verify-deployed-bytecode.ts` is typechecked by nothing. The reason was not recoverable, and the entry says so rather than inventing one.

**ENTRIES ARE STEM-RELATIVE**, which this cascade made concrete and every list now states: what belongs in a repo's list is what IT drops from ITS stem. jolly-roger's three arrived in template-commit-reveal's diff and were deliberately not copied down, because they are already absent from the stem branch it merges, so they cannot be omissions there. The guard makes that unarguable - it only ever reports a path present in the stem and absent here.

## What is still open

bleeps and mandalas have correct lists and no guard: `check-omissions.mjs` reaches them on their next cascade from here, and until then their entry blocks name the by-hand audit. Their lists were written from outside those repos, so two of the reasons say what is true today rather than why it was done.
