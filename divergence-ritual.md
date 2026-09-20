# The divergence ritual, branch by branch

`check-shared-divergence.sh` takes its scope from the environment, so a run is only worth as much as the list it was given. This file is that list, for every branch in this repo, with the counts each run produced when it was last measured. It lives here rather than on the branches because it is about the TEMPLATE TREE: an orphan branch shares no history with `main`, so nothing here can arrive in a scaffolded app or in a downstream repo through a merge.

Run it after every cascade merge, and run it with the block that belongs to the branch you just merged into. It compares COMMITTED refs, so commit the merge first and `--amend` if it fails.

## The three widths, and why there are three rather than one

| width | `WATCH` | what it is for |
| --- | --- | --- |
| **default** | `core/connection core/transaction` | the composability guarantee: the layer every branch combines through |
| **core** | `web/src/lib/core` | everything a downstream repo INHERITS as jolly-roger's half and is not supposed to edit |
| **wide** | `web/src web/test web/e2e` with `EXT="ts svelte"` | the whole app surface |

**The default width is not enough, and `with/embedded-chain` is the branch that proved it.** Its tab-leader fix is in `core/tab-leader`, which neither default path covers, so for a while it had a divergence check that could not see half its own budget. Any branch whose edits fall outside `core/connection` and `core/transaction` has the same hole, which is the argument for running the core width too rather than for widening the default.

**The wide width is a different instrument and is not a pass/fail gate for every branch here.** See "What the wide run means, per branch" at the end: on `with/local-signer` it reports 37 files and every one of them is that branch's reason to exist, so an `ALLOWED` list for it would be an inventory rather than a budget.

## Which `BASE` a branch takes

Two answers, and both runs are worth having because they answer different questions.

- **`BASE=main`** answers "what does this capability ADD", which is what a reader of the tree wants and what the `ALLOWED` lists below are written against.
- **`BASE=<the branch's own stem>`** answers "what did the last cascade leave behind", which is the failure the script exists for, because the stem is what the fanout actually merged from.

For `with/local-signer`, `with/embedded-chain` and `website` the stem IS `main`, so the two coincide. They differ for `with/hosted-account` (stem `with/local-signer`) and for `integration` (two stems), and both are given below.

## `with/local-signer`

```sh
FEATURES="with/local-signer" \
ALLOWED="web/src/lib/core/connection/mode.ts" \
  bash <(git show tooling:check-shared-divergence.sh)

WATCH="web/src/lib/core" FEATURES="with/local-signer" \
ALLOWED="web/src/lib/core/connection/mode.ts web/src/lib/core/ui/faucet/faucet-actions.ts" \
  bash <(git show tooling:check-shared-divergence.sh)
```

Expected: 40 shared files at the default width with **1** allowed difference, 101 over `core/` with **2**.

`mode.ts` holds `TARGET_STEP`, which is the one line that makes this branch sign in. `faucet-actions.ts` is the second entry and it is a weaker one, recorded honestly rather than dressed up: it was found by the first run that ever watched `core/` on this branch, it had no declared budget before that, and **not all of it is this branch's.** Returning the claim's transaction and `dispensedByClaim` are general ("a wallet serves a cached balance until it sees a new block") and would be a straight improvement on `main`; only the default-target policy - fund the authenticated account and never the local signer - is a statement about a branch where a signer exists. So the entry is a **candidate to be split**, with the general half going up and the policy half staying, which would take this branch's `core/` budget back to one file. Not done here: it is a change on `main` that cascades to every node in the tree and is its own task.

## `with/hosted-account`

```sh
FEATURES="with/hosted-account" \
ALLOWED="web/src/lib/core/connection/mode.ts" \
  bash <(git show tooling:check-shared-divergence.sh)

WATCH="web/src/lib/core" FEATURES="with/hosted-account" \
ALLOWED="web/src/lib/core/connection/mode.ts web/src/lib/core/ui/faucet/faucet-actions.ts" \
  bash <(git show tooling:check-shared-divergence.sh)

# and against its OWN stem, which is what a cascade merges from
BASE=with/local-signer FEATURES="with/hosted-account" ALLOWED= \
  bash <(git show tooling:check-shared-divergence.sh)
BASE=with/local-signer WATCH="web/src/lib/core" FEATURES="with/hosted-account" ALLOWED= \
  bash <(git show tooling:check-shared-divergence.sh)
```

Expected against `main`: the same 1 and 2 as `with/local-signer`, because both entries are INHERITED from it and this branch changes neither. Expected against `with/local-signer`: **0 at both widths**, 42 and 104 shared files, with `ALLOWED=` empty.

**AND THAT ZERO IS THE POINT, WHICH MEANS `mode.ts` IS NOT THIS BRANCH'S SWITCH AND THE README SAID IT WAS.** Measured 2026-09-20: `TARGET_STEP` is `SignedIn` on `with/local-signer` AND on `with/hosted-account`, so reverting `mode.ts` here in `with/local-signer`'s favour would change nothing at all. What makes this branch the hosted one is `web/.env`, which says so in its own comment ("THIS LINE IS WHAT MAKES THIS VARIANT THE HOSTED-ACCOUNT ONE"), plus a devDependency, a `wallet-host` script, 28 lines of playwright config, 101 of e2e runner and a 293-line e2e suite.

The correction matters beyond the sentence. `ALLOWED`'s second side - an entry that has STOPPED differing has had its reason falsified - is the guard against a cascade quietly undoing a branch, and **for this branch it is pointed at a file that cannot undo anything.** The file that could is `.env`, which no width watches and which is not a `.ts` file, so the guard does not reach it. That is not fixed here; it is written down because a guard believed to cover something it does not is worse than a missing one.

## `with/embedded-chain`

```sh
FEATURES="with/embedded-chain" \
ALLOWED="web/src/lib/core/connection/remote.ts web/src/lib/core/connection/types.ts" \
  bash <(git show tooling:check-shared-divergence.sh)

WATCH="web/src/lib/core" FEATURES="with/embedded-chain" \
ALLOWED="web/src/lib/core/connection/remote.ts web/src/lib/core/connection/types.ts web/src/lib/core/tab-leader/TabLeaderService.ts web/src/lib/core/tab-leader/storage-lock.ts" \
  bash <(git show tooling:check-shared-divergence.sh)
```

Expected: 40 shared files at the default width with **2** allowed, 101 over `core/` with **4**.

`remote.ts` and `types.ts` are the world seam (`ConnectableChainInfo`, `establishConnectionOn`, `storagePrefix`, `walletPrompts`). The two tab-leader entries are a LATENT CORRECTNESS FIX rather than a feature of the branch - the leader election was one per ORIGIN, so two contexts in one tab competed and the second world's transaction observer never ran - and they are marked in `README.embedded-chain.md` as going up to `main`. When they do, this branch's `core/` list drops back to the first two and the entries must come off the list in the same change, or the run fails with `ALLOWED BUT IDENTICAL`, which is the script working.

The branch's full budget, with a reason per file, is `README.embedded-chain.md` on the branch. It is 7 shared files at the wide width, not the 5 its own summary line used to claim.

## `integration`

```sh
FEATURES="integration" \
ALLOWED="web/src/lib/core/connection/mode.ts web/src/lib/core/connection/remote.ts web/src/lib/core/connection/types.ts" \
  bash <(git show tooling:check-shared-divergence.sh)

WATCH="web/src/lib/core" FEATURES="integration" \
ALLOWED="web/src/lib/core/connection/mode.ts web/src/lib/core/ui/faucet/faucet-actions.ts web/src/lib/core/connection/remote.ts web/src/lib/core/connection/types.ts web/src/lib/core/tab-leader/TabLeaderService.ts web/src/lib/core/tab-leader/storage-lock.ts" \
  bash <(git show tooling:check-shared-divergence.sh)
```

Expected: 40 shared files at the default width with **3** allowed, 101 over `core/` with **6**. Every entry is INHERITED: three from `with/local-signer`, four from `with/embedded-chain`, with `mode.ts`... counted once. This node adds none of its own and that is its acceptance criterion, not a description of it.

**So the run that matters for `integration` is the three-way one, and it is the same shape `template-commit-reveal@with/all` uses.** Each run takes its OWN list, because `ALLOWED` is two-sided and an entry that is legitimately identical against one parent makes a false claim there:

```sh
# against with/local-signer: exactly what the embedded-chain axis contributes
BASE=with/local-signer FEATURES="integration" \
ALLOWED="web/src/lib/core/connection/remote.ts web/src/lib/core/connection/types.ts" \
  bash <(git show tooling:check-shared-divergence.sh)

# against with/embedded-chain: exactly what the local-signer axis contributes
BASE=with/embedded-chain FEATURES="integration" \
ALLOWED="web/src/lib/core/connection/mode.ts" \
  bash <(git show tooling:check-shared-divergence.sh)

# against main: the union, and nothing else
FEATURES="integration" \
ALLOWED="web/src/lib/core/connection/mode.ts web/src/lib/core/connection/remote.ts web/src/lib/core/connection/types.ts" \
  bash <(git show tooling:check-shared-divergence.sh)
```

Measured on creation, 2026-09-20, all three green, and with `ALLOWED=` empty they name exactly 2, 1 and 3 files and no others. At the wide width the union is **43**, which is `with/local-signer`'s 37 plus `with/embedded-chain`'s 7 less the one file both edit (`context/core.ts`, the node's only merge conflict and the only place it had to compose rather than inherit).

## `website`

```sh
FEATURES="website" ALLOWED= bash <(git show tooling:check-shared-divergence.sh)
WATCH="web/src/lib/core" FEATURES="website" ALLOWED= bash <(git show tooling:check-shared-divergence.sh)
```

Expected: **0 at both widths**, with nothing allowed. It edits `lib/ui/navbar/navbar.svelte` and `routes/+page.svelte` and nothing else in the app, so it needs no list. A branch with an empty `ALLOWED` that passes is the cheapest thing in this file to keep true; if it ever needs an entry, that is a question about the branch rather than about the run.

## The runs that prove the rest

Every block above should be run once more with `ALLOWED=` empty. That is the run which proves the clean files are clean because they are IDENTICAL rather than because the script matched nothing, and each one must name exactly the files its list names and no others.

```sh
for b in with/local-signer with/hosted-account with/embedded-chain integration website; do
  FEATURES="$b" ALLOWED= bash <(git show tooling:check-shared-divergence.sh)
  WATCH="web/src/lib/core" FEATURES="$b" ALLOWED= \
    bash <(git show tooling:check-shared-divergence.sh)
done
```

Measured 2026-09-20, as `drifted / shared`:

| branch | default | `core/` | wide |
| --- | --- | --- | --- |
| `with/local-signer` | 1 / 40 | 2 / 101 | 37 / 424 |
| `with/hosted-account` | 1 / 40 | 2 / 101 | 37 / 424 |
| `with/embedded-chain` | 2 / 40 | 4 / 101 | 7 / 424 |
| `integration` | 3 / 40 | 6 / 101 | 43 / 424 |
| `website` | 0 / 40 | 0 / 101 | 2 / 424 |

## What the wide run means, per branch

The wide width is reported above rather than gated, because it does not mean the same thing on every branch and pretending otherwise would produce four `ALLOWED` lists of which two were fiction.

**`with/embedded-chain`, `integration` and `website` are gateable at the wide width**, at 7, 43 and 2 files. For the first and last the list is short enough to read, and for `integration` it is arithmetic on its parents rather than a budget of its own.

**`with/local-signer` and `with/hosted-account` are not**, at 37 files each. That is not a finding and it is not drift: this branch changes who signs a game move, and 37 files is what that costs across `account/`, `context/`, `view/` and the e2e fixtures. It is also the shape the game tree's own plan names as the one to avoid - Decision 3 sets `with/hosted-account`'s 3 conflict events in 24 merges as the bar and `with/local-signer`'s 65 in 44 as the failure - so the honest statement is that this branch was built before that rule and is measured by it rather than held to it. What IS gateable on it is the two narrower widths, which is why they exist.

**The reason to write that down rather than leave the wide column blank:** a checker that quietly widens its own scope is worse than one that fails, and a checker given a 37-entry `ALLOWED` list has done exactly that - every entry would be permanently satisfied, nothing could ever be added to the branch and be noticed, and the run would report green forever.
