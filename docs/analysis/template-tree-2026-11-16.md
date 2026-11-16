# The template tree, measured on 2026-11-16

A read-only analysis of every node of wighawag's template tree, the stray branches around them, and the four libraries the next features build on (etherfold, fuzd, missiv, push-notification-server). It is the measurement behind `docs/plans/template-tree-features.md` on this branch. Nothing was changed in any repo while it was taken: every repo was fetched (`git fetch --all --prune`), `origin/<branch>` refs were analysed, each node's verify ran in a detached worktree under `~/dev/worktrees/<repo>/analysis/<branch>` that was removed afterwards, and no e2e suite ran.

How the numbers were taken: one read-only subagent per repo (or pair of small repos), with a session-wide slot script allowing three verifies at once. Their full notes were working files, not kept; every figure that matters is in this file. Where a figure is a measurement it says so; where it is a judgement it says that too.

**One deviation from the brief, recorded.** The verify of every node from jolly-roger down runs `test:unit`, which is `vitest run --project server && vitest run --project client`, and the `client` project is vitest browser mode: a headless Chromium on a port. The brief forbade starting a browser or using a port, which nobody noticed until the first verifies had run. The rule was then amended mid-session: the client project is NOT RUN, and the unit figures below are the server project only, with the client project's file count beside it. Before the amendment the client project did run once on: jolly-roger's six nodes, template-commit-reveal's seven, reveal-or-die, stratagems, infinite-gambit and bleeps (all passed; for example jolly-roger 9 to 12 files, template-commit-reveal 16 files and 84 tests, reveal-or-die 15 and 78, stratagems 16 and 79, infinite-gambit 16 and 88, bleeps 9 and 44). Two verify process groups that had reached the client project were stopped by the parent and rerun server-only. No process from the session is left.

## The tree, as measured

Discovered from the `stem` remote of every repo under `~/dev/github/wighawag/` and each repo's `offshoot` branch (`fanout.config.json`). `(n behind)` is how many stem commits a node is missing (a cascade pending). Every node not marked is level with its stem (the stem's head is an ancestor).

```
template-svelte@main                                  (root, "stem": null)
├─ template-svelte-tailwind@main
│  ├─ template-svelte-shadcn@main
│  │  ├─ jolly-roger@main
│  │  │  ├─ jolly-roger@with/local-signer
│  │  │  │  ├─ jolly-roger@with/hosted-account
│  │  │  │  └─ jolly-roger@integration        [with/local-signer, with/embedded-chain]
│  │  │  │     ├─ template-commit-reveal@main             (stemBranch integration)
│  │  │  │     │  ├─ @with/pixi-js
│  │  │  │     │  ├─ @with/nft-identity
│  │  │  │     │  ├─ @with/fuzd
│  │  │  │     │  ├─ @with/indexer
│  │  │  │     │  ├─ @with/all               [with/pixi-js, with/nft-identity]
│  │  │  │     │  │  └─ reveal-or-die@main                 (stemBranch with/all)
│  │  │  │     │  │     └─ bomber-world@main
│  │  │  │     │  └─ @with/fuzd-pixi-indexer [with/fuzd, with/pixi-js, with/indexer]
│  │  │  │     │     ├─ stratagems@main                   (stemBranch with/fuzd-pixi-indexer)
│  │  │  │     │     └─ infinite-gambit@main  (111 behind) (stemBranch with/fuzd-pixi-indexer)
│  │  │  │     └─ template-zk-game@main  (18 behind)       (stemBranch integration)
│  │  │  │        └─ duel-in-the-dark@main
│  │  │  ├─ jolly-roger@with/embedded-chain   (also a stem of integration)
│  │  │  ├─ jolly-roger@website
│  │  │  ├─ bleeps@main  (10 behind)
│  │  │  └─ mandalas@main  (10 behind)
│  │  ├─ arts@main  (6 behind)                 no offshoot branch
│  │  │  └─ palestine@main                      no offshoot branch
│  │  ├─ conquest-demo@main  (6 behind)
│  │  └─ template-svelte-docs@main  (6 behind)  no offshoot branch
│  │     └─ rocketh-website@main                no offshoot branch
│  ├─ template-svelte-tailwind-blog@main  (4 behind)
│  │  ├─ conquest-website-2@main
│  │  └─ ronan-eth@main
│  └─ wabisabi-website@main  (4 behind)         no offshoot branch
```

23 repos, 33 nodes. Not in the tree, though they look as if they were: `~/dev/github/wighawag/chess-battleground` is a SYMLINK to `infinite-gambit` (created 2026-11-09), and 8 worktrees under `~/dev/worktrees/chess-battleground/` point at `infinite-gambit/.git` through it; `wasisabi-website` and `wasisabi` are symlinks to `wabisabi-website` and `wabisabi` (a misspelling, which makes a directory scan see the repo twice); `template-trip` and `india-travel-2026-mumbai` form a separate family (no shared history with template-svelte). No other owner directory under `~/dev/github/` holds a repo with a `stem` remote into this tree.

## Part 1: status

### Per node

"server" is the vitest server project (files / tests, all passed unless said); "client" is the browser project's file count, NOT RUN. Guards: `om` = `check-omissions.mjs`, `drift` = `check-stem-drift.mjs`, `dang` = `check-dangling-imports.mjs`, `div` = `.offshoot-divergences` and its test; "absent" means the script is not on that branch (it arrives with a pending cascade where one is pending). Checks are svelte-check errors / warnings.

| node | head | date | ahead / behind stem | check | unit | other suites | guards | format:check |
|---|---|---|---|---|---|---|---|---|
| template-svelte@main | 7e5a4c1 | 11-15 | root | 0/0 | 7 / 40 | | om, drift: the root case (exit 1 by design); dang absent | web passes |
| template-svelte-tailwind@main | b011a55 | 11-15 | 46 / 0 | 0/0 | 7 / 40 | | om ok, drift ok (7 shared differ); div would be needed | web passes |
| template-svelte-shadcn@main | 709f3fc | 11-15 | 32 / 0 | 0/0 | 8 / 44 | | om ok, drift ok (7) | web passes |
| jolly-roger@main | c47a5581 | 11-15 | 669 / 0 | 0/0 | 93 / 1044, client 9 | contracts not in verify | om ok (3), drift ok (34), dang absent, div absent | FAIL: `web/src/lib/core/ui/overlay/registry.ts` |
| jolly-roger@with/local-signer | 6495c592 | 11-15 | 212 / 0 | 0/0 | 110 / 1315, client 10 | | om ok, drift ok (48) | FAIL: registry.ts |
| jolly-roger@with/hosted-account | 6d848f0f | 11-15 | 153 / 0 | 0/0 | 110 / 1315, client 10 | | ok | FAIL: registry.ts |
| jolly-roger@with/embedded-chain | c3d37df4 | 11-15 | 77 / 0 | 0/0 | 100 / 1087, client 11 | | ok | FAIL: registry.ts |
| jolly-roger@integration | 0d0fe8a7 | 11-15 | 193 / 0 and 328 / 0 | 0/0 | 117 / 1358, client 12 | | ok against both stems | FAIL: registry.ts |
| jolly-roger@website | f5954f27 | 11-15 | 177 / 0 | 0/0 | 93 / 1044, client 9 | | ok | FAIL: registry.ts and two own pages |
| template-commit-reveal@main | 0ea456ef | 11-15 | 381 / 0 | 0/0 | 182 / 2092, client 16 | contracts 16 / 84 | om, drift, dang ok; div absent (29 of 49 modified shared files unexplained) | FAIL: registry.ts, `web/src/lib/game/render/README.md` |
| template-commit-reveal@with/pixi-js | 50b06acc | 11-15 | 171 / 0 | 0/0 | 184 / 2105 | 16 / 84 | ok | FAIL: same two |
| template-commit-reveal@with/nft-identity | 034cedc6 | 11-15 | 163 / 0 | 0/0 | 183 / 2102 | 16 / 84 | ok | FAIL |
| template-commit-reveal@with/fuzd | d77fa430 | 11-15 | 76 / 0 | 0/0 | 187 / 2134 | 16 / 84 | ok | FAIL |
| template-commit-reveal@with/indexer | ba29f069 | 11-15 | 44 / 0 | 0/0 | 187 / 2120 | 16 / 84 | ok | FAIL |
| template-commit-reveal@with/all | b0b4f2b5 | 11-15 | 450 / 0, 458 / 0 | 0/0 | 185 / 2115 | 16 / 84 | ok against each stem | FAIL |
| template-commit-reveal@with/fuzd-pixi-indexer | 70d41990 | 11-15 | 330 / 0, 235 / 0, 362 / 0 | 0/0 | 194 / 2175 | 16 / 84 | ok against each stem | FAIL |
| reveal-or-die@main | 4702169a | 11-15 | 336 / 0 | 0/0 | 194 / 2289, client 15 | | om ok (65), drift ok (52), dang ok; div absent (about 20 modified framework files) | FAIL: contracts 8, web 2 (inherited) |
| bomber-world@main | 991e90b7 | 11-15 | 154 / 0 | 0/0 | 207 / 2383, client 15 | | om ok (4), drift ok (68), dang ok; div absent | FAIL: contracts 9, web 3 |
| stratagems@main | 269f2d64 | 11-15 | 1660 / 0 | 0/0 | 196 / 2164, client 16 | | om ok (93), drift ok (36), dang ok, div ok (36 entries = 36 modified) | FAIL: root 4, indexer 1, contracts 26, web 4 |
| infinite-gambit@main | 5bc96292 | 11-10 | 150 / **111** | 0/0 | 206 / 2228, client 16 | contracts 210 | om ok (49), dang ok; drift and div absent (arrive with the cascade); about 70 modified shared files | passes (in its verify) |
| template-zk-game@main | 46539426 | 11-09 | 35 / **18** | 0/0 | 114 / 1322, client 13 (incl. the in-browser prover) | circuits 4 / 4, contracts 19 | om ok (24); drift, dang absent | FAIL: 4 files |
| duel-in-the-dark@main | 77ea736 | 11-09 | 82 / 0 | 0/0 | 115 / 1343, client 13 | circuits 14 / 14, contracts 40 | om ok (21) | FAIL: 2 inherited files |
| arts@main | 3b38fec | 10-30 | 146 / **6** | 0/0 | web 36 / 352 | sim 66 / 932 (not in the tree's verify) | om ok; drift absent | web and sim pass |
| palestine@main | be2486b | 10-30 | 5 / 0 | 0/0 | web 36 / 352 | sim 66 / 932 | om ok | pass |
| conquest-demo@main | 793f2b8 | 11-03 | 59 / **6** | **9 errors** (the tree's verify never builds `conquest-demo-server-app`); 0/0 after building it | web 47 files / 598 (+2 skipped), server 4 / 85 | | om ok | FAIL: 66 game files |
| template-svelte-docs@main | af8f8dd | 10-30 | 18 / **6** | 0/0 | 13 / 99 | | om ok (1); drift absent | web passes |
| rocketh-website@main | 33b207b | 10-30 | 22 / 0 | 0/0 | 13 / 99 (needs `ROCKETH_DIR`, a built rocketh checkout) | | om ok (23) | web passes |
| template-svelte-tailwind-blog@main | d2400c2 | 10-27 | 42 / **4** | 0/0 | 6 / 33 | | om ok; drift absent | not run |
| conquest-website-2@main | 133edbf | 10-27 | 121 / 0 | 0/0 | 6 / 33 | | om ok (6) | not run |
| ronan-eth@main | fa50686 | 10-27 | 53 / 0 | 0/0 | 6 / 33 | | om ok (2) | web passes |
| wabisabi-website@main | 5c77435 | 10-27 | 12 / **4** | 0/0 | 8 / 42 | | om ok | FAIL: 12 own files |
| bleeps@main | 1f6de317 | 11-09 | 510 / **10** | 0/0 | 110 / 1183, client 9 | | om ok (23); drift absent (the stem's copy passes) | FAIL: 2 files |
| mandalas@main | 82e19907 | 11-09 | 266 / **10** | 0/0 | 92 / 1040, client 9 | | om ok (24); the stem's drift check FAILS on `web/src/lib/core/ens/index.ts` (left at the stem's pre-c7252e38 version) | FAIL: 2 files |

Every verify passed (rc 0) except conquest-demo's, which cannot pass as configured. Unit counts for jolly-roger and template-commit-reveal match the figures their `work` branches recorded on 2026-11-15.

**Dependency drift between nodes** (every `package.json` up to two levels deep on every node; 39 packages have more than one range, 31 of them only in stratagems): the tree is aligned to a single range for every shared package except: stratagems (contracts on TypeScript ^5.4 against ~6.0, vitest ^1.6, prettier ^3.3 and prettier-plugin-solidity 1.x, ldenv ^0.3, as-soon ^0.0.9, wait-on ^7, pwag 0.3 in web; and AHEAD on rocketh ^0.26 / hardhat-deploy ^2.2 / the @rocketh packages against the tree's ^0.25 / ^2.1.1, a bump that belongs at jolly-roger); reveal-or-die and bomber-world (`abitype` ^1.2.3 against ^1.3.0, `@rocketh/web` ^0.19.30 against ^0.19.27); template-svelte-docs and rocketh-website (`bits-ui` ^2.20.2 and `@lucide/svelte` ^1.62.0 against ^2.18.2 and ^1.33.0: shadcn bumps made below their home); arts and palestine (`pixi.js` ^8.22 against ^8.19); conquest-demo (`@libsql/client` ^0.15 and `remote-sql-libsql` ^0.0.6 against ^0.17.4 and ^0.0.7); infinite-gambit (`pinnace` 0.18 against 0.17). Three dependabot bumps wait at jolly-roger (below) while the root is at the same old versions.

### Main checkouts (reported, not changed)

Every main checkout in scope is clean (0 porcelain lines). Behind their upstream: template-svelte main by 2, template-svelte-tailwind main by 4, template-svelte-shadcn main by 6, jolly-roger (checked out on `website`) by 12, template-commit-reveal (checked out on `with/all`) by 85, reveal-or-die main by 124, bomber-world main by 149. Every other checkout is level. One uncommitted change lives in a worktree rather than a main checkout: duel-in-the-dark's `work` worktree holds a spec status fix (milestone E `proposed` to `accepted`) never committed.

Local branches with commits not on any remote: stratagems `backup/step-O-pre-rebase`, `specify-9` (kept unlanded by stratagems' plan, as history) and `wip/X2-pure-core` (fae7d656, the measured pure core of step X2); fuzd `work/reject-a-schedule-into-a-spent-slot` (2 commits, an in-progress fix). template-commit-reveal's `px1/with/fuzd-pixi-indexer`, `px1/with/indexer` and `px2/with/fuzd-pixi` LOOK ahead of their upstream only because their upstream is set to the wrong branch: every commit is an ancestor of the origin node branches (landed under the same SHAs). Many preview branches (jolly-roger ph1/*, s8/*, t1/*, webevm09/*, lan; template-commit-reveal dlg/*, pa1/*, crc/*, ...; stratagems 76 merged previews) are behind-only and safe to prune, with their worktrees.

### Last e2e recorded

| repo | last result | date | where recorded |
|---|---|---|---|
| jolly-roger (its own six nodes) | main 44 green; with/hosted-account 49 of 50 (a delegation timeout that passes alone); website 43 of 44 (a service-worker gateway flake) | 2026-08-22 | origin/work `work/specs/proposed/overlay-navigation-model.md` |
| template-commit-reveal | main 62 passed, with/nft-identity 62, with/fuzd-pixi-indexer 68 | 2026-11-15 | origin/work `work/tasks/done/a-games-fixtures-on-the-stems.md` |
| stratagems | 67 passed, 1 skipped (10.9 min) | 2026-11-15 | origin/main plan, step C2's log entry |
| reveal-or-die, bomber-world | step P1's preview branches: reveal-or-die 59 passed, 2 skipped (10.0 min); bomber-world 62 passed, 2 skipped (12.8 min) | 2026-11-15 | stratagems' plan, the log entry "step P1: built and verified" (and the work task `stay-put.md` on reveal-or-die's `work`) |
| infinite-gambit | none on the lean-rules board; `offline-ai.e2e.ts` recorded failing (it still drives the placement game) | 2026-11-06 | origin/main `work/notes/observations/offline-ai-e2e-still-drives-the-placement-game.md`, backlog `chess-e2e-on-the-lean-rules-board` |
| template-zk-game, duel-in-the-dark | as recorded on their `work` branches (last activity 2026-11-04) | 2026-11-04 | origin/work |
| bleeps, mandalas | a full e2e at their 2026-08-26 hand merge; mandalas' mint and burn cases are `test.fixme` (3) | 2026-08-26 | jolly-roger `work/specs/proposed/service-layers.md` Wave 0.3 |
| the template-svelte line (root to shadcn, blog, docs, sites) | no e2e suite | | |

So no full e2e of jolly-roger's own nodes is recorded since 2026-08-22, three months of cascades ago, and none at all for infinite-gambit on the board it now plays.

### Stray branches (no fanout.config.json names them)

Counts are commits not in the repo's `main` by `git cherry` (patch-equivalence).

| repo | branch | not in main | last commit | recommendation |
|---|---|---|---|---|
| jolly-roger | `tooling` | 8 (orphan by design) | 09-20 | keep: maintenance scripts that must never be inherited |
| jolly-roger | `v1`, `v1-public` | 410 and 409, unrelated history | 03-19 | tag `v1` (v1 contains v1-public), then delete both |
| jolly-roger | `dependabot/.../adapter-static-3.0.11`, `.../vite-8.2.4` | 1 each | 11-14, 10-27 | close here; apply both at template-svelte (their home) and cascade |
| jolly-roger | `dependabot/.../kit-3.0.0` | 1 | 10-27 | close here; a SvelteKit 3 migration is its own step at the root, not a merge |
| template-commit-reveal | `old` | 1 | 02-23 | keep (the only copy of the pre-reset history), or convert to a tag |
| template-commit-reveal | `proto/game-slot` | 4 | 10-01 | delete; the `$game` alias never landed and stratagems' U2 took another route (record the idea first if still wanted) |
| template-commit-reveal | `with/fuzd-pixi` | 1 patch not in with/fuzd-pixi-indexer (a comment in `nix/game.nix`, a file that no longer exists) | 11-04 | delete: replaced by with/fuzd-pixi-indexer |
| reveal-or-die | `deployment/rise-testnet` | 0 | 01-14 | delete |
| bomber-world | `ui/skin` | 0 | 11-03 | delete |
| stratagems | alpha1, alpha1test, alpha2, ancient8_testnet, base, composablelabs, composablelabs-merged, computed-points, dev, docs, fast, missiv, paragraph-xyz, redstone-holesky, revamp, sepolia (16) | 0 each | 2024 | delete; `alpha1-final` tags the last alpha1 build |
| stratagems | `production` | 0 patches (3 merge commits) | 2023-09-18 | delete |
| stratagems | `join-template-commit-reveal`, `step-8` | 0 | 11-07, 10-30 | delete: history, merged into main (the plan says so) |
| stratagems | `proto/go-style` | 8 | 10-31 | keep or tag: the prototype step 9's look was chosen in, referenced by the plan |
| stratagems (local) | `wip/X2-pure-core` | local only | 10-31 | tag, then delete the branch |
| infinite-gambit | brand/home-page, brand/infinite-gambit, chore/license-readme-brand, ci/ipfs-pin, config/sepolia, feat/ghost-spawn-points, prep/pixi-wood-board, try/pixi-all-attacked | 0 to 11, all superseded or squash-merged | 11-06, 11-07 | delete (and their 8 worktrees under `~/dev/worktrees/chess-battleground/`) |
| infinite-gambit | `fix/army-death-after-king-capture` | 1 (e475b4b3), not in main, merge-tree clean | 11-06 | MERGE: a real render fix (a captured army burns only after its captor lands) |
| template-zk-game | `offline-crs`, `turn-limit` | 0 | 11-04 | delete |
| duel-in-the-dark | `lan`, `turn-limit` | 0 | 11-04 | delete |
| template-svelte-docs | feat/articles-dir, feat/docs-site, feat/pending-articles, fix/link-check-edge-cases | 0 | 10-27, 10-28 | delete |
| rocketh-website | docs/article-deployer-pays-gas, feat/announcement-article, feat/article-draft-until-release | 0 | 10-28 | delete |
| rocketh-website | `pr-assets`, `pr-screenshots/announcement-article` | 1, 4 (orphan screenshot branches) | 10-27, 10-28 | keep: pull-request images link to them |
| template-svelte-tailwind-blog | `spike/rocketh-docs` | 1 | 10-27 | delete (marked throwaway in its own message) |
| conquest-website-2 | feat/devlog-press, feat/landing, feat/template-update | 0 | 01 to 07 | delete |
| ronan-eth | `feat/image-loading-shimmer` | 1 | 07-30 | delete (conflicts in two files; recreate if wanted) |
| bleeps | 2024, dao, demo, demo-dev, melody-improvement, todo | 0 to 3 | 2021 to 2024 | delete; `gif-export` (1, wip) the user's call |
| etherfold | five `work/*` branches, `fetchTimestamp`, `docs` | 0 to 4, all landed or obsolete | | delete; keep `gh-pages`, `changeset-release/main` |
| fuzd | `work/batch-schedule-and-flag-cli`, `feat/use-zod`, `old-fixes` | 0, 6 (landed otherwise), 1 | | delete; keep `feat/fuel` (archive) |
| missiv | `feat/refactor`, `refactor-hono` | 0 | 2024, 2025 | delete; glance at `restructure` (1); keep `conquest-2025-1`, `wip-generic-do` |

No open dependabot branch exists anywhere else in the tree.

### Open `work/` items worth naming

- jolly-roger `work` (f527ab28): one backlog task (`onchainstate-refetch-on-deployments-change`, 2026-08-03), three proposed specs (`overlay-navigation-model` in progress, `reactive-deployments-without-full-reload`, `service-layers`, all 2026-09-07), about 30 observations and findings "spotted" between 2026-08-03 and 08-31 with no follow-up (some now false: `signer-balance-store-appears-unused` names a file that no longer exists, `e2e-replace-previous-message-fails-pre-existing` says fixed in its own body). The newest done task says "on pc1/*, NOT pushed" though its commits are on origin. A triage pass is due.
- template-commit-reveal `work`: HANDOFF.md (604 lines) asks to be deleted when done and is partly stale; `games-on-this-foundation.md` (1537 lines) still says hotseat and NPCs remain though both are done; backlog `cancel-a-commitment` (09-17), `vocabulary-in-the-game-repos` (09-15); OPEN findings `the-e2e-suite-is-not-type-checked` (09-11), `a-free-placement-is-counted-as-a-new-claim-every-time` (09-22, not fixed), `mandalas-verify-cannot-pass-from-a-clean-clone` (09-19); about 25 observations "spotted"; two empty files `17` and `18.` at the branch root (a shell slip, 2026-09-15).
- infinite-gambit (its work is on `main`): four backlog tasks, two of them unblocked and not started (`chess-pixi-switch`, `outcomes-report-promotion-and-stones`), 13 observations from 11-06 and 11-07.
- stratagems: L3-box and D-live, both the user's.
- etherfold: 6 backlog tasks (09-26 to 09-30), 4 proposed specs; `trigger-system` DROPPED (moved outside etherfold by ADR-0005). fuzd: 3 backlog tasks and an open security observation (`GET /admin/paymentAccountBroadcaster` returns a derived account with its private key, behind admin auth). missiv: 6 observations from 07-24 (DEV fail-open backdoors, unauthenticated `_initDB`, e2e failing 5 of 6 on schema drift). push-notification-server: no work/ at all; one findings file (2026-08-21) naming three gaps.

### Unrecorded deviations from the stem

Only stratagems records every modified shared file (`.offshoot-divergences`, 36 entries, checked by a unit test). Elsewhere: template-svelte-tailwind 7 and template-svelte-shadcn 7 modified shared files, recorded nowhere; jolly-roger main 34 (the four shadcn `*-content.svelte` patched to portal into `$lib/core/ui/layers`, NotificationOverlay and NavigationProgress z-index, explained only by in-file comments); template-commit-reveal main 29 of 49 unexplained (among them `lib/core/connection/remote.ts` and `types.ts`, jolly-roger's files, patched here); reveal-or-die about 20 framework files; bomber-world including a persisted wire key bump (`offline.ts:199`, `:v2`), exactly what the storage-as-wire rule wants recorded; infinite-gambit about 70 beyond 24 rename-only files; template-zk-game and duel-in-the-dark 9 files modified only by the package rename; the blog's descendants copy and edit `types.ts`, `api/posts` and `feed.xml`; ronan-eth 21 files. Every repo that modifies shared files would need a divergence list.

## Part 2: code quality

### Conventions, tree-wide

Measured on every node: no `$app/*` import outside `web/src/lib/kit` (only comments) anywhere in the jolly-roger and template-commit-reveal subtrees; no `.svelte.ts` file and no rune in a `.ts` file anywhere; `epoch` appears only as the allowed UNIX-epoch comment (`web/src/lib/core/transaction/in-flight.ts:61`); every deploy script from jolly-roger down is `deterministic: true` and every other deploy transaction is guarded (`020_deploy_stake_sale.ts`), with two exceptions: bleeps deploys neither deterministically nor with guards (it opted out of the LAN build in `.offshoot-omissions`, but AGENTS.md still states the rule), and stratagems opts into determinism by a `deterministic` tag (`contracts/deploy/.config/index.ts:15-20`), undocumented. The template-svelte line has the known `$app/state` leak in `Head.svelte` (with a stale "KNOWN_LEAKS is empty" comment at `web/test/framework-boundary.test.ts:21,27`) and conquest-website-2 a `$app/navigation` import in its Header.

Logic in `.svelte` files: borderline everywhere at the framework level (ConnectionFlow 229-line script, the navbar 142 to 165) but the async work is delegated to `.ts`; real breaks are in leaves: conquest-demo `PlanPanel.svelte:34-96` (domain logic) and `EventLogPanel.svelte:21-33` (a secrecy redaction rule in UI), conquest-website-2 the press TOC and the Header's search index, bleeps `routes/bleeps/+page.svelte` (sale polling, a hard-coded supply of 448), duel-in-the-dark `+page.svelte:60-68` (a mode decision).

### Per repo, the top five (cost S, M, L, and what each blocks)

**template-svelte.** (1) Two `core/` components every styled descendant rewrites in place (`core/notifications/Notifications.svelte`, `core/service-worker/VersionAndInstallNotfications.svelte`), M, blocks clean cascades to tailwind and shadcn. (2) The `Head.svelte` `$app/state` leak, M. (3) Untested core utilities with a latent off-by-one at `url.ts:29`, S. (4) The fanout verify skips `web:build`, S. (5) `isExternalSameTabLink` logic inside `NavigationProgress.svelte`, S.

**template-svelte-tailwind.** (1) The same two components rewritten wholesale, M (fix at the root). (2) 7 modified shared files recorded nowhere, S. (3) No guard that Tailwind is wired, S. (4) Verify never compiles the CSS, the one thing this repo adds, S. (5) A pasted Tailwind UI comment block inside `Notifications.svelte`, S.

**template-svelte-shadcn.** (1) `core/ui/README.md` documents jolly-roger's modal contract at this tier, S. (2) AGENTS.md "root of a template tree" wording inherited by every node, S at the root. (3) `fanout.config.json` lacks the `branches` key its descendants carry, S. (4) The clone is 6 behind, S. (5) A stale README tree, S.

**jolly-roger.** (1) format:check red on all six nodes (`registry.ts:495`), inherited by every descendant, S. (2) No e2e of its own nodes since 2026-08-22, M. (3) The composition root `web/src/lib/context/core.ts` is 1100 lines on main and 1709 on integration, edited by every variant, L (the service-layers spec's Wave 0.1 split it into builders; the file grew back). (4) Push notifications: unwired by design, untested, the payload types declared twice (`web/src/service-worker/index.ts:255-290` and `push-notifications/index.ts:8-36`), its README pointing at the wrong file for the push listener, and a protocol that signs nothing (the `account` type demands `signer.privateKey` at `index.ts:67` and nothing reads it), M. (5) Upstream-able patches (the shadcn layer patches belong at template-svelte-shadcn) and the three dependabot bumps that belong at the root, S to M.

**template-commit-reveal.** (1) format:check red on all seven nodes, S. (2) jolly-roger's `lib/core/connection/remote.ts` and `types.ts` patched here (the world connection's `nodeURL`), M; template-zk-game, a sibling under `integration`, still has the bug. (3) `offline.ts` (1307 lines against the stem's 332) copied per game: 17 of its 17 functions reappear in stratagems' (several byte-identical) and 15 in reveal-or-die's, M. (4) Stale records (the "NOT pushed" note, HANDOFF's table, the spec's "hotseat and NPCs remain", root files `17` and `18.`), S. (5) No divergence list (29 unexplained) and the e2e suite not type-checked since 2026-09-11, M.

**reveal-or-die.** (1) No divergence list for about 20 modified framework files, M. (2) format:check red, S. (3) Generic code in the game: the splash (`web/src/lib/ui/loading/splash.ts`, 153 lines, untested, a `window.splash` global, an unnamespaced `__visited` key, swallowed errors) belongs at `with/pixi-js`; the table settlement lifecycle is reimplemented in three games (below), M to L. (4) Unused web deps (`@pixi/devtools`, `abitype`, `pixi-viewport`, `pretty-ms`), S plus a `pnpmDepsHash`. (5) The template's five branch READMEs and three orphan scripts inherited, S.

**bomber-world.** (1) No divergence list, including the `:v2` wire key, S to M. (2) format:check red, S. (3) README's duplicated paragraph and lost install notes, S. (4) `offline.ts` patched for a per-seat identity instead of a hook in the template's offline world, M. (5) The same unused deps and inherited files, plus two art tests that would skip silently if the art moved (`it.skipIf`), S.

**stratagems.** (1) format:check red at every level because its prettier configuration and plugin version differ from the stem's, so byte-identical stem files fail, S to M. (2) The contracts toolchain lags (TypeScript 5.4, vitest 1.6, ldenv 0.3) while rocketh is ahead, M (lockfile, `pnpmDepsHash`, the LAN rebuild). (3) Determinism by tag, undocumented, S, a decision before D-live. (4) Reference-game copies under stratagems names (`diagnostics.ts` identical, `hud.ts` 87%), M. (5) Contract rules still re-derived in TypeScript (`winnings.ts` share split, `leaderboard.ts` reward maths) where `score.ts` already uses the bytecode sandbox, plus the ERC721 suite skipped since 2023, M.

**infinite-gambit.** (1) The cascade of 111 stem commits pending, 9 conflicting paths by `git merge-tree`, two of them design merges (`offline.ts`, `offline-players.ts` against the stem's new offline-table module), L. (2) 24 shared files differ only by the stale `template-commit-reveal` to `chess-battleground` rename, some now false, S. (3) The unmerged render fix and 8 superseded branches pinning 9 worktrees through the symlink, S. (4) Generic code in the leaf: a vendored Router10X60 fix, a hover seam in `game/core` and `game/render`, a backed GameToken and StakeSale, and the table settlement shape, M. (5) Two board renderers kept in lockstep and no chess e2e on the lean-rules board, M.

**template-zk-game.** (1) The cascade of 18 commits (clean by merge-tree), S. (2) The browser project, which holds the in-browser prover test AGENTS.md requires after a Noir or bb.js bump, runs in no verify that forbids a browser, S (decide where it runs). (3) format:check red, S. (4) A `GAME` constant in jolly-roger's `$app-specific` and a world constant would remove 5 modified shared files here and in every game, M at jolly-roger. (5) Dead `$lib/embedded` (the offline route is omitted) and AGENTS.md contradicting itself on `flake.nix`, S to M.

**duel-in-the-dark.** (1) Merged strays and an uncommitted spec status in the work worktree, S. (2) The prover test as above, S. (3) `web/src/lib/duel/state.ts` copied from the template's `game/state.ts`, and the ZK credit configuration, both belong in template-zk-game, M. (4) 9 shared files modified only by the package rename, M (a tree-level naming decision). (5) format:check and the mode decision in `+page.svelte`, S.

**arts, palestine.** (1) No `offshoot` branch, so the tree verifies them with the stem's web-only command and skips 932 sim tests, `tsc` and format, S. (2) The 6-commit cascade, S. (3) An unrecorded `dark` class in `app.html:2`, S. (4) Template names never replaced (`tempalte-svelte-monorepo`, a typo every node of the svelte line inherits), S at the root. (5) palestine: no spec path from arts' design to its own work, and arts' inherited work/ items live in palestine's work/ where a runner could task them, S to M.

**conquest-demo.** (1) Its fanout verify cannot pass (never builds the server app it imports), S. (2) The 6-commit cascade, S. (3) Domain and secrecy logic in two panels, M. (4) 66 files fail format, S. (5) Merged local branches, S.

**template-svelte-docs, rocketh-website.** (1) The 6-commit cascade, then rocketh-website's, S. (2) Generic shadcn components and the bits-ui and lucide bumps living here rather than at template-svelte-shadcn, M. (3) A shadcn-styled `+error.svelte` here, S. (4) ModeWatcher's default against a hard-coded `dark`, S. (5) rocketh-website's verify depends on an out-of-repo built checkout (`ROCKETH_DIR`), S.

**template-svelte-tailwind-blog and its two sites.** (1) The publish rule differs between `api/posts:18` and `feed.xml`, S. (2) No posts-source seam: both descendants copy and edit `types.ts`, `api/posts` and `feed.xml`, M. (3) The 4-commit cascade, S. (4) Feed logic untested and duplicated with template-svelte-docs' `core/docs/feed.ts`, M. (5) conquest-website-2: a dead duplicate route (`routes/search/+server.ts`) and dead helpers; ronan-eth: CI deploys without check or tests (`.github/workflows/ipfs-pin.yml:36-39`) and `embed-projects.mjs` regex-parses a TypeScript file, S.

**wabisabi-website.** (1) The 4-commit cascade, S. (2) 12 files fail format, S. (3) No `offshoot` branch, so the verify skips the build CI depends on, S. (4) A copied update notice and a forked `Head.svelte`, M upstream. (5) The misspelt symlinks, S.

**bleeps, mandalas.** (1) The 10-commit cascades, S; mandalas' `ens/index.ts` left at an old stem version (the drift check fails on it), S. (2) format:check, S. (3) bleeps' deploys follow neither rule its AGENTS.md states, S to M; mandalas' mint and burn e2e disabled (3 `test.fixme`, a broken `evm_snapshot` isolation), M. (4) The e2e type-check include and the app CI workflow, duplicated between the two, belong at jolly-roger, S. (5) Navbar rewrites as copies of the stem's, and mandalas' `formatError` inside `core/utils`, M.

### Duplicated across the tree (a home that is not where the code is)

- **The table's end**: reveal-or-die `UsingGameTable.sol` (`_closeTable` 332, `_releaseLeftover` 377, `_withdraw` 414-470: survivors share the leftover pot), stratagems `StratagemsTable.sol` (`settle`, `_finalise`: a score per member, argmax with ties, `TableSettled(winners, topScore)`), infinite-gambit `UsingGameTable.sol` (`_tally(budget)`, a resumable bounded count, then a pro-rata split by material, `TableSettled(winner, pot, material)`). Three implementations of "close once, settle, record a result, pay each claimant once"; the client side likewise (stratagems `table-end.ts` 488 lines and `score.ts`' `rankScores` and `settleBatches`, about 150 to 190 generic lines; infinite-gambit `table-payout.ts`). None of it is at template-commit-reveal, whose own `UsingCommitReveal.sol:223` comment anticipates "a settlement, a score". This is F4's ground.
- **The offline world's boot** (`offline.ts`), above.
- **jolly-roger's own core patched below it** (`connection/remote.ts`, `types.ts` at template-commit-reveal).
- **The overlay layers patched into stem-owned shadcn components** at jolly-roger.
- **The styled notification panels** rewritten at every level of the svelte line.
- **The blog's posts source** copied by both sites.
- **The splash** at reveal-or-die (bomber-world already patched its colour).
- **Push**: jolly-roger's `core/service-worker/push-notifications/` is a descendant of push-notification-server's example client (`examples/svelte/src/lib/web/service-worker/push-notifications/index.ts`), while that repo's own `subscription-client` package is an empty stub.

### Tests that pass vacuously

None in the jolly-roger and template-commit-reveal subtrees' unit suites. Conditional `test.skip` in e2e (`offline-table.e2e.ts:105,112`, `offline-ai.e2e.ts:201`, `offline-hotseat.e2e.ts:178`, `faucet.e2e.ts:12`) skip when a testid or a URL is absent, by design for descendants; in the template itself a removed testid turns a failure into a skip. missiv-client's only test is `expect(1 + 2).toBe(3)`, push-notification-server's only test is a "hello world" through workerd and its example's is the same `1 + 2`. stratagems' `StratagemsAsERC721.test.ts` is skipped since 2023. mandalas has 3 `test.fixme`.

### Dead code and legacy files (each `git grep`ped)

jolly-roger's push-notifications module (deliberate, documented) and `web/package.json:58` `generate-pwa-icons-and-tags`, which runs on a file the repo omits; reveal-or-die and bomber-world: the template's five branch READMEs (`README.all.md` and four more, referenced only by each other), `contracts/scripts/commitMove.ts`, `error-selector.ts`, `.vscode/settings.json.default`; conquest-website-2: `routes/search/+server.ts`, `press/+page.ts`'s `extractHeadings`, `lucide-svelte.d.ts`; ronan-eth: `MailingList.svelte`, an unused `embeddedProjects`; mandalas: `utils/stores/base.ts`; template-zk-game: `$lib/embedded` (9 files) with its route omitted; template-commit-reveal `work`: `17`, `18.`.

### Ranked tree-wide: the top ten, by cost to fix against what they block

1. **format:check red from jolly-roger down** (`web/src/lib/core/ui/overlay/registry.ts:495`, inherited by every node below jolly-roger but infinite-gambit, which reformatted its copy against AGENTS.md's advice; plus template-commit-reveal's `game/render/README.md`). S at two homes, cascaded. Blocks a format gate anywhere below jolly-roger and adds a noise line to every review.
2. **The tree is not level**: 9 nodes behind their stem (template-zk-game 18 and then duel-in-the-dark, bleeps 10, mandalas 10 with a drift failure, arts 6 then palestine, conquest-demo 6, template-svelte-docs 6 then rocketh-website, the blog 4 then its two sites, wabisabi-website 4). S each (all clean by merge-tree where measured). Blocks the drift guard reaching them, and every feature cascade must start from a level tree or it carries unrelated merges.
3. **infinite-gambit 111 behind with 9 conflicting paths**, two of them design merges, and 24 rename-only shared files. L. Blocks F1's cascade to the newest game, the drift guard and divergence test there, and every later stem fix.
4. **Verify gaps**: the browser project (zk's prover test included) has no home in a browser-free verify; the e2e suite is not type-checked (open since 2026-09-11); jolly-roger's verify runs no contracts tests; the root's skips `web:build`; conquest-demo's cannot pass; arts, palestine, template-svelte-docs, rocketh-website and wabisabi-website have no `offshoot` branch, so they are verified with the wrong command. S to M. Blocks trusting "verify passed" as evidence.
5. **No e2e of jolly-roger's own nodes since 2026-08-22**, and none of infinite-gambit's board. M. Blocks F1 to F3, which land at jolly-roger and need a known-green e2e baseline there.
6. **Divergences recorded in one repo only.** stratagems' `.offshoot-divergences` and its test are repo-local; every other node that modifies shared files (jolly-roger 34, template-commit-reveal 29 unexplained, reveal-or-die, bomber-world, infinite-gambit about 70, zk and duel 9 each, the blog's sites) records them nowhere. M (lift the check to the root beside `check-stem-drift.mjs`, then a list per node). Blocks telling a decision from drift in every cascade review, which F1's move up the tree needs most.
7. **The table's end reimplemented in three games** and absent at template-commit-reveal. L. Blocks F4 (a high score generalises a result every game records the same way, or it duplicates a fourth time).
8. **The service prerequisites are not green** (the service-layers spec's R4: a service is green and API-stable in its own repo before its branch exists): push-notification-server's `/push` and `/register` are unauthenticated and `/push` is not idempotent (its own findings, GAP-1 to GAP-3), it runs on cf-worker only and has no API test; missiv has DEV fail-open backdoors, an unauthenticated `_initDB`, e2e failing on schema drift and no notification hook; the trigger consumer etherfold's ADR-0005 places outside etherfold does not exist anywhere. M to L. Blocks F2 and F3 outright.
9. **jolly-roger's core patched below it, and game code copied per game**: `lib/core/connection/remote.ts` and `types.ts` at template-commit-reveal (template-zk-game keeps the bug), `offline.ts` copied in four games, the splash, the hover seam and the Router fix in infinite-gambit. M each. Blocks cheap cascades of exactly the files F1 to F4 touch (connection, offline world, tables).
10. **Hygiene**: about 60 stray remote branches (list above), the chess-battleground and wasisabi symlinks (the first pins 8 worktrees), 3 mis-tracked px branches, stale records on two `work` branches, three dependabot bumps at the wrong level, stratagems' toolchain lagging and rocketh ahead of the tree. S each, every deletion the user's to approve. Blocks nothing directly; makes every scan and every plan read slower and less trustworthy.

## The libraries the features build on

**etherfold** (origin/main a4c312fd, 2026-10-26, clean). Published: `@etherfold/browser` 0.13.0, `core` 0.12.0, CLI `etherfold` 0.12.0, `server` 0.5.2, `graphql` 0.2.2, `processor-entities` 0.4.2, `state-store*` 0.5.1, and more. Unit suites run port-free all pass (core 81 files / 1157, server 31 / 475, state-store-sqlite 24 / 1041, ...); browser, IndexedDB, graphql-over-HTTP, CLI and platforms not run (browser or port). In the tree: template-commit-reveal `with/indexer` and `with/fuzd-pixi-indexer`, stratagems and infinite-gambit, all on the same ranges; nothing in jolly-roger. **The external tracker** is etherfold's *consumer* or *trigger service*, built OUTSIDE etherfold by decision (ADR-0005, "Triggers run outside the indexer-server"; the in-repo trigger system was dropped, `work/specs/dropped/trigger-system.md`). What etherfold offers it, on `@etherfold/server` as mounted by `etherfold run`: `GET /{indexer}/feed` (the retraction-aware emission stream, cursor held by the consumer, `packages/server/src/api/feed.ts:135`), `GET /{indexer}/canonical?gate=` (live entries at or below a gate, a REWIND answered on reorg, `feed.ts:232`), `GET /{indexer}/state-moved` (SSE, Node hosts only; a Cloudflare Worker answers 501), `/graphql`, and in process `onStateMoved`. ADR-0007 gives the consumer two lanes (safe at finality, fast at a depth, cancel on retraction), ADR-0009 makes an action an authenticated, idempotent HTTP call and names push-notification-server's `POST /push` as its first target (and as violating idempotency), ADR-0011 bounds by rate and digests, ADR-0012 expires triggers unless renewed, ADR-0013 makes conditions data and actions code. No aggregation or ranking primitive: a score is a field a handler writes, and a top-N is a query (`orderBy` and `first` work on SQLite; IndexedDB scans until two blocked backlog tasks land), so a global leaderboard wants a server-side `etherfold run`. etherfold has no factory-discovered source: a processor follows a fixed contract list.

**fuzd** (origin/main 34dae6d, 2026-10-30, clean). `@fuzd/client` 0.12.0, `@fuzd/server` 0.12.1, CLI `fuzd` 0.12.0. Unit: client 8, server 24, port-free, pass. Its `pnpm install` exits 1 on pnpm 11 (`ERR_PNPM_IGNORED_BUILDS`) after succeeding, so its own verify fails on a fresh machine (S). In the tree through `with/fuzd`; no notification or webhook on execution, and none needed by F1 to F4.

**missiv** (origin/main 79fe3ab, 2026-07-24; last code 2026-03-11; clean). missiv-client, -common, -server 0.3.x and platforms cf-worker (D1, Durable Object rooms), bun (rooms), nodejs (HTTP only: `getRoom` throws). DMs stored and end-to-end encrypted (ECDH on delegate keys and xchacha20poly1305); rooms (global chat per domain, `@<domain>`, last 100 messages, rate-limited) unencrypted. Identity: every request signed by a DELEGATED key bound to the wallet address at `/register` by a wallet signature over `originPublicKeyPublicationMessage` (`packages/common/src/index.ts:214-216`): the shape of jolly-roger's with/local-signer. Client: `.ts` stores on `svelte/store` (fits the tree's rules). No push, webhook or notification of any kind. Tests: server 1, client-server 7 (meaningful, about 10 s, no port), the client's one test vacuous, end-to-end failing. In the tree: nowhere since stratagems' step 6c removed it (260dc8af, 2026-10-26: "dropped until a messaging layer exists in jolly-roger", P10). Before, stratagems ran `helper-services/missiv` (wrangler dev, D1 and Durable Objects on port 34003) and DMs keyed on the wallet address with the local delegate key (alpha1-final `web/src/lib/stratagems/ui/missiv/missiv.ts:28-33`).

**push-notification-server** (origin/main 1e0d908, 2026-08-22, clean, one branch). Packages 0.0.3, cf-worker only (D1, one `Subscriptions(address, domain, subscriptionID, ...)` table). Routes: `POST /register` (`// TODO authentication of address`), `GET /registered/:address/:domain/:subscriptionID`, `POST /push` (declarative Web Push, VAPID, `// TODO authentication via tokens`, deletes on 410 and 404, not idempotent). Cannot watch a chain and should not (etherfold ADR-0005). Its `docs/findings/trigger-service-integration.md` names GAP-1 (`/push` unauthenticated, HIGH), GAP-2 (no ownership proof at `/register`, HIGH, asking for ONE shared implementation with the trigger service's registration), GAP-3 (no idempotency key, MEDIUM) and ENHANCEMENT-1 (`GET /registered/:address/:domain`). Effectively untested. jolly-roger's push-notifications module speaks exactly its three routes, keyed by the delegated signer's address.

**The prior spec.** jolly-roger `work` already holds `work/specs/proposed/service-layers.md` (2026-08-26, last touched 2026-09-07): `with/indexer` from `main` (read-only, no signer), `with/messaging` from `with/local-signer`, `with/notifications` from `[with/indexer, with/local-signer]`, one `with/all`, rules R1 to R6 (a layer has a fixed shape; degrades to its absence; `main` stays decentralised; a service is green in its own repo first; verification per node; a layer augments, never replaces), and a GreetingsRegistry example for the indexer (a badge counting an address's messages, an aggregate no direct read gives). Since it was written, `with/webevm` became `with/embedded-chain` and `integration`, and template-commit-reveal built its own `with/indexer` at a lower level (stratagems' step X1, PX6 and PX7). The plan reconciles the two.
