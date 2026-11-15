---
title: A game's built packages linked into the e2e run's worktree, as its package.json declares them
type: task
status: done
created: 2026-11-15
from: stratagems' port plan, step C1 (`main`, `work/plans/join-template-commit-reveal.md`, section "Step C"), decisions C-2, C-3 and C-12 taken with the maintainer on 2026-11-15
---

# A game's built packages in the e2e worktree

## Why

`scripts/run-e2e-tests.sh` runs in a fresh git worktree, which holds the tracked files and nothing else. A game whose app imports something it BUILDS (stratagems: `common/dist` and `indexer/dist`, built by its `prepare` and gitignored) has to link it in, and stratagems did so with a hunk in its copy of the script, one of three that conflicted with every cascade touching it. Linking every workspace package's `dist` by convention was rejected: a package that must build in the worktree (the contracts package) would be silently replaced by the main checkout's stale build.

## Done, 2026-11-15, on local preview branches `pc1/*`, NOT pushed

**`main`** (from `origin/main` dc208e10): `677333fd` `scripts/e2e-link-built.mjs`, called by the script once the worktree's dependencies are linked: it reads `"e2e": {"linkBuilt": [...]}` from the root `package.json` and links each path from the main checkout into the worktree; a path the main checkout has not built fails the run, naming it; an entry outside the repo, absolute, or already present in the worktree (tracked, so not a build output) is refused, the list checked in full before anything is linked. No field (this template) links nothing. Documented in `web/TESTING.md` ("The run happens in a git worktree") and in README beside the `"lan"` field. `c47a5581` puts the new script in the repo's style. 5 unit cases in `web/test/e2e-link-built.test.ts`, run against the real script; red before it existed. The real run measured too: with a `linkBuilt` naming a path never built, `run-e2e-tests.sh` stops before any node starts, naming the path, and cleans up its worktree.

The same cascade carried `template-svelte`'s new `scripts/check-stem-drift.mjs` (C-2: a shared file left at an old version of the stem's, which a merge resolved "ours" makes and nothing else sees; run by `apply-omissions.sh` during a merge), through template-svelte-tailwind and template-svelte-shadcn: every merge clean.

**Cascaded**, every merge clean: `with/local-signer` 6495c592, `with/embedded-chain` c3d37df4, `website` f5954f27, `with/hosted-account` 6d848f0f, `integration` 0d0fe8a7; then template-commit-reveal (its `main` from `integration`, its six nodes) and its descendants reveal-or-die and bomber-world. Not cascaded: bleeps, mandalas, template-zk-game and duel-in-the-dark, infinite-gambit, and template-svelte's other descendants (arts, palestine, conquest-demo, template-svelte-docs, rocketh-website, template-svelte-tailwind-blog, conquest-website-2, ronan-eth, wabisabi-website); each takes it with its next cascade.

## Measured

Check 0 errors and 0 warnings on every branch; unit, the 12 new cases included (7 drift, 5 link): `main` 1044 + 44, `with/local-signer` 1315 + 58, `with/embedded-chain` 1087 + 49, `website` 1044 + 44, `with/hosted-account` 1315 + 58, `integration` 1358 + 63. `check-omissions` and the new drift check clean at every node against its stem. The script's e2e measured downstream, at template-commit-reveal `main` (62 passed), `with/nft-identity` (62 passed) and `with/fuzd-pixi-indexer` (68 passed), reveal-or-die (59 passed, 2 skipped) and bomber-world (62 passed, 2 skipped), each its baseline, run at the first pass of the cascade; the second pass changed only the drift check (a repo merely behind its stem is not drift) and the link script's formatting, and every node's check and unit were run again after it (above).
