---
title: "The tree is ten repos and thirteen nodes, not four and seven, and three of the missing ones are eight commits behind"
type: finding
status: spotted
created: 2026-08-22
source: "`offshoot-fanout --dry-run` from template-svelte against the saved registry, after the audit's own tree map failed to predict what it reported"
follows: the-framework-seam-belongs-at-the-root-template
---

# The map was drawn from the repos in play, not from the registry

`work/notes/findings/the-framework-seam-belongs-at-the-root-template.md` opens with "The tree is four repos and seven live nodes, all owned by the same person" and draws a diagram to match. Both numbers are wrong, and the diagram is missing five repos. The saved registry at `~/.offshoot-stems/template-svelte.json` has recorded ten repos since 2026-08-18, which is four days before that note was written.

```
template-svelte                        (root)
└─ template-svelte-tailwind
   ├─ template-svelte-shadcn
   │  └─ jolly-roger                   4 nodes: main, with/local-signer, with/hosted-account, website
   │     ├─ bleeps                     430 own commits   (grows from main)
   │     ├─ mandalas                   181 own commits   (grows from main)
   │     └─ template-commit-reveal     100 own commits   (grows from with/local-signer)
   └─ template-svelte-tailwind-blog
      ├─ conquest-website-2
      └─ ronan-eth
```

**Ten repos, thirteen live nodes.** `variant/offline` remains out of scope and is not counted.

This is exactly the failure the reconciliation skill warns about in its first section: "Run it rather than trusting any snapshot. Sites get built on these templates without any list being updated." The audit mapped the tree by looking at the repos it was working in, which is a snapshot, and the snapshot happened to stop at jolly-roger's own branches.

## Which conclusions move, and in which direction

Every one that moves gets **stronger**, which is why this was easy to miss and worth stating clearly.

- **The framework-seam backport.** Its headline argument is "it makes one sentence true for seven nodes instead of one". It is thirteen. The three jolly-roger descendants each carry a full copy of `core/`, so the `$app/*` decoupling reaches three more real applications than the note claims.
- **The push-notifications decision.** "Byte-identical and unwired at every level" was verified across eight nodes. It is inherited by three more repos that were never checked. The argument against deleting it at jolly-roger gets stronger: a modify/delete conflict would now be paid by three downstream applications, not just by the branches.
- **ADR-0005's cascade cost.** "One contested merge, not four" was measured against jolly-roger's branches only. That accounting is still right for the branches, but `core/` also lives in bleeps, mandalas and template-commit-reveal, and moving seven files out of it is a change all three will eventually take. None of them modifies those seven files today, so the cost is small, but it is not zero and it was not counted.

## What does NOT move

The conflict measurements are unaffected. They were taken per merge commit on jolly-roger's own branches and are correct as scoped. The "two real edges plus two nearly free ones" claim is a statement about jolly-roger's branches and remains true of them. It should not be read as a statement about the tree.

## The three downstream repos are stale, and it predates this work

All three are wired, active (last commits 2026-08-19) and **eight commits behind jolly-roger's pre-audit `main`**, with conflicts that already existed before this audit began:

| repo | conflicts vs pre-audit main | vs main after the audit's 7 commits |
|---|---|---|
| bleeps | 4 files | 6 files |
| mandalas | 9 files | 11 files |
| template-commit-reveal | 13 files | 13 files |

That last row is measured from `main` and is misleading, because `template-commit-reveal` does not descend from `main`. From its true parent, `with/local-signer`, it conflicts in **three** files rather than thirteen, and the tool cannot be told to use that parent. See `work/notes/findings/a-child-repo-cannot-declare-which-parent-branch-it-descends-from.md`, which is the reason it needs a permanent ignore rather than the temporary skip its two siblings need.

The audit's seven commits add two files each to bleeps and mandalas (`README.md` and `web/src/web-config.json`) and nothing to template-commit-reveal. Both additions are one-time: `web-config.json` conflicts because the `repoURL` and `communityURL` keys land beside content those repos have rebranded, and once resolved it stays resolved.

**That trade is worth naming honestly.** The `repoURL` move was justified on removing `website`'s recurring `+layout.svelte` conflict, and it does (that file is now byte-identical to `main` there). Measured across the real tree it also adds a one-time `web-config.json` conflict at two downstream repos. Recurring cost removed at one node, one-time cost added at two. Still clearly positive, but the note that justified it only counted one side because it only knew about one side.

The rest of the tree, including the entire blog branch and jolly-roger's own three branches, is in sync.

## What it costs and who pays

Whoever cascades the framework-seam backport next, because those three repos will block it. They have no descendants, so the blockage is contained and the rest of the tree still cascades past them. But three applications have been drifting for eight commits with nobody watching, and drift is the one cost in this tree that compounds: the `variant/offline` note in the merge-tax finding makes exactly this argument about a branch, and the same thing is now happening to three repos.

## Proposed fix

1. **Re-run `discover --save` before trusting any tree map again**, and quote the registry rather than a hand-drawn diagram. Cost: one command.
2. **Correct the node count in the framework-seam note**, which strengthens its own argument.
3. **Decide on the three stale repos separately from any template work.** They need a cascade with conflict resolution in application code (`context/index.ts`, `navbar.svelte`, `setGreeting.ts`), which is a different job from a template change and should not be entangled with one. Doing it now is cheaper than doing it after the framework-seam backport lands on top.
