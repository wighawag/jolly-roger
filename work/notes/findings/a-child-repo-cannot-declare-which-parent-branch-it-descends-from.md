---
title: "template-commit-reveal descends from with/local-signer, offshoot-fanout can only feed it from main, and the difference is 13 conflicts instead of 3"
type: finding
status: fixed
created: 2026-08-22
source: "compared `merge-tree` against all three candidate parents, then read `childNodes` in offshoot-fanout's nodes.js"
follows: the-tree-is-thirteen-nodes-not-seven
---

# A cross-repo edge has no branch, and one of ours needs one

`template-commit-reveal` is built on jolly-roger's `with/local-signer` variant, not on `main`. That is not a guess: it carries all six of the variant's `core/` additions (`connection/credits.ts`, `connection/signer-rpc.ts`, `connection/wallet-account.ts`, `ui/layers.ts`, `ui/oauth/GoogleIcon.svelte`, `ui/confirm/confirmation.ts`), and `bleeps` and `mandalas` carry none of them.

`offshoot-fanout` cannot express this. Cross-repo children are fed from one branch only, and which branch is not configurable:

```js
// nodes.js, childNodes()
if (node.branch === plan.primary) {
    for (const child of childrenOf(node.repo, tree)) { ... }
}
```

`primary` is "the root branch named `main`, else the first root branch". A child repo's config controls which of ITS OWN branches receive an update (`entryBranches`), but nothing lets it say which branch of the parent SENDS. So every cross-repo child hangs off the parent's `main`, and a repo built on a variant branch is wired to the wrong parent by construction.

## What it costs, measured

Merging `template-commit-reveal` from each candidate, against its current HEAD:

| source | conflicts |
|---|---|
| jolly-roger@main (what the tool does) | **13** |
| jolly-roger@with/local-signer (the truth) | **3** |
| jolly-roger@with/hosted-account | 3 |

From the correct parent the three are `web/e2e/tests/delegation.e2e.ts`, `web/src/lib/context/index.ts` and `web/src/routes/demo/lib/setGreeting.ts`, which are precisely the three the rest of the tree already knows are genuinely divergent. That is a healthy result for a repo with 100 commits of its own.

The other ten are entirely artificial. `web/.env`, `e2e/fixtures/test.ts`, `account/connectors.ts`, `context/AcrossPages.svelte`, `core/ui/modal/modal.svelte`, `dev-accounts.ts`, `ui/navbar/navbar.svelte`, `routes/+layout.svelte`, `contracts/lib/contractCall.ts` and two test files are exactly the set that differs between `main` and `with/local-signer`. They conflict only because the tool is presenting the branch WITHOUT the signer stack as the authority for a repo built ON the signer stack.

## Why this is a hazard and not just noise

A conflict count is the signal a maintainer uses to judge how much thought a merge needs. Thirteen conflicts in a repo eight commits behind reads as ordinary drift, so it invites the ordinary resolution. Here the ordinary resolution is wrong in a way that typechecks: taking the incoming side on `modal.svelte`, `contractCall.ts`, `navbar.svelte` or `connectors.ts` silently reverts a downstream application off the variant it is built on, and several of those reverts would compile clean. The template's own merge-tax note makes the same point about `context/index.ts`, that a wrong resolution there is a runtime bug rather than a type error, and this multiplies that risk by ten files.

This has not happened, because the repo has never been cascaded from `main`. It is one unattended `offshoot-fanout` run away from happening.

## What to do

**Now, and it is free:** keep `template-commit-reveal` permanently in the ignore list rather than treating it as a temporary skip, so no cascade can reach it by accident. Its two siblings do NOT need this: `bleeps` and `mandalas` really do descend from `main` and are correctly wired, they are merely behind. The distinction matters, because "three stale repos" invites one fix for all three and only two of them can take it.

**When it is cascaded:** do it by hand from `with/local-signer`, expect the three conflicts above, and resolve them as variant-versus-variant rather than variant-versus-main.

**DONE 2026-08-22.** Implemented in `offshoot-fanout` as `stemBranch` (`offshoot` c4426c7): a root branch names the branch of the PARENT repo that feeds it, defaulting to the primary. `template-commit-reveal` now reports 4 conflicts merging `jolly-roger@with/local-signer` instead of 14 merging `jolly-roger@main`, and renders under the variant where it belongs. The merge machinery needed no change, which is the sign the seam was in the right place: `MergeSource` already fetched an arbitrary `parent.branch` and only the graph forced it to the primary.

**One hazard remains until the new version is installed, and it is silent.** The released binary's config validator drops unknown keys rather than rejecting them, so an OLD `offshoot-fanout` reading the new config parses it happily, ignores `stemBranch`, and cascades from `main` exactly as before, with nothing in the report to say the key was dropped. Verified: the binary on PATH still reports 14 files merging `jolly-roger@main` against the same config the built one reads correctly. So the config is not a guard on its own. Until `offshoot-fanout` is upgraded, `template-commit-reveal` must stay in the ignore list, and the ignore is what is actually protecting it.

**The original analysis, kept because it is what justified the change:** let the edge carry a branch. The child already declares its own entry branches, so the natural shape is for the child to name the parent branch it grows from, in the same `stem` vocabulary the in-repo edges already use, something like `{"branches": {"main": {"stem": "stem/with/local-signer"}}}`. The in-repo case already distinguishes a chain from a combination; the cross-repo case currently cannot distinguish anything at all. Worth raising against `offshoot-fanout` rather than working around forever, because the workaround is "remember not to run the tool", which is the kind of rule that holds until the day it does not.

## For the audit's numbers

This does not change any measurement in the other notes, because none of them counted `template-commit-reveal`. It does change the shape of the tree map: the edge from jolly-roger to `template-commit-reveal` starts at `with/local-signer`, so the diagram in `the-tree-is-thirteen-nodes-not-seven.md` should show it hanging off the variant rather than off the repo.
