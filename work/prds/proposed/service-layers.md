---
title: Service layers (indexer, messaging, sync, notifications, in-browser chain) as feature branches
type: prd
status: proposed
created: 2026-08-26
decides-with: offshoot's feature-branch model (offshoot README, "Where the feature sets come from")
touches: with/local-signer, with/hosted-account, variant/offline
---

# PRD: Service layers

> **This file is the entry point for the whole plan.** Read it first and in full. Two companion documents hold the parts that belong elsewhere, and everything else is here.
>
> - `work/notes/findings/iso-timestamps-make-the-secp256k1-db-signature-ambiguous.md`, on this branch, is why Wave 2 is gated. Its conclusion is also carried upstream as an amendment to issue 2 of `secp256k1-db`'s `KNOWN-ISSUES.md`, so that repo does not need this one to act.
> - `docs/plans/play-modes.md` in `template-commit-reveal` holds hotseat and the fixed player set. They are a seam rather than a layer, so they are deliberately out of scope here and must not become `with/*` branches.
>
> This branch is not part of the main working tree, so `ls` and `find` from the repo root will not show it. Read a file with `git show work:<path>`, or, if `git worktree list` shows a linked worktree for `work`, read it from disk there.

## Problem

The template demonstrates a fully onchain app with no centralised component. The next step adds five capabilities that each need a service: an indexer, push notifications, account-data sync, chat and DMs, and an in-browser chain. Each is a mature repo already. None of them is integrated, and there is no agreed shape for integrating them.

Done badly this is a combinatorial disaster. Five capabilities is thirty-two combinations, and verification cost is per node and does not shrink when a merge is clean. Done well it is five nearly-free branches and one integration branch, because the tree already contains a worked example of a nearly-free branch.

This document fixes the graph, the shape of a layer, and the order. It does not design any individual integration.

## What already exists, so nobody re-derives it

**The mechanism is shipped.** `offshoot` resolves `offshoot add <feature>` against the stem graph in `fanout.config.json` on the `offshoot` branch, using `"feature": true` to mark a branch adoptable, and multi-stem branches to publish combinations. Its own worked example in the README is `with/messaging`, `with/sync`, `with/hosted-account` and `with/all`. Nothing needs building for this to work.

**The reference implementation exists.** `stratagems` runs `helper-services/{fuzd,missiv,secp256k1-db}` plus `indexer/` under one zellij layout. Every question about whether these services can coexist locally has already been answered by an app that does it. What stratagems does not have is composability: it is one bespoke wiring. This work is that wiring, factored.

**The cost of a layer has been measured, and there are two shapes.** From `work/notes/findings/the-merge-tax-is-in-the-composition-root-not-in-core.md`:

| branch | merges | conflict events | shape |
|---|---|---|---|
| `with/local-signer` | 44 | 65 | rewrites application source |
| `with/hosted-account` | 24 | 3, none in application source | adds env, a script, a zellij pane, e2e, two deps |

`with/hosted-account` is the target shape for every layer here. A layer that comes out local-signer-shaped means the seam is wrong, not that the feature is big. This table is the acceptance criterion for the whole PRD.

## The feature graph

```
main
├─ with/indexer          etherfold. read-only, needs no signer
├─ with/webevm           chain in the tab. needs no signer
└─ with/local-signer     (exists)
   ├─ with/hosted-account  (exists)
   ├─ with/messaging       missiv
   └─ with/sync            synqable over secp256k1-db

with/notifications  stem: [with/indexer, with/local-signer]   feature: true
with/all            stem: [with/notifications, with/sync, with/messaging, with/hosted-account, with/webevm]
```

Three decisions are load-bearing.

**`with/indexer` stems from `main`, not from `with/local-signer`.** Indexing is read-only and needs no wallet. Chaining it under the signer would hand every indexer adopter a signing layer they did not ask for, which is the "a chain lies about the dependency" trap the reconciliation skill names explicitly. The same argument puts `with/webevm` on `main`.

**A flat fan, not a chain and not a lattice.** A chain is cheap to cascade and dishonest about feature sets. A lattice is honest and unmaintainable. The fan is honest, and the cost of honesty is one integration branch.

**Exactly one integration branch.** `with/all` is published; every other combination is refused by `offshoot add`, naming `with/all`. That refusal is the design, and a refusal that keeps recurring is the demand signal that a second integration branch has been earned. Do not pre-empt it.

`with/notifications` is the one genuinely multi-stem feature: triggers consume the indexer feed, and trigger registration needs the delegated signer. Confirm that a branch can be both multi-stem and `feature: true` before relying on it. The README's graph algebra says a branch carries the union of the features it stems from plus its own, which implies yes, but no published example shows one.

## Rules that keep the cost linear

**R1. A service layer has a fixed shape.** A dependency, one client constructed in the composition root, one zellij pane, env vars, e2e. Nothing else. If a layer needs to change application source, stop and fix the seam instead.

**R2. Every layer degrades to its absence, and the UI says so rather than reporting a fault.** The template already states this for the wallet host: empty `PUBLIC_WALLET_HOST` means wallet-only sign-in, "a supported configuration and not an error". That is promoted here from a per-feature nicety to a standing rule. Without it, `with/all` quietly becomes the most centralised app in the tree, and the template's whole claim goes with it.

**R3. `main` stays fully decentralised. Every centralised component is confined to a feature branch, is open source, and is self-hostable.** This is what makes the fan honest: an adopter reading the branch list can see exactly what each capability costs them in trust, and `main` remains the answer for anyone who wants none of it.

**R4. A service must be green and API-stable in its own repo before its branch exists.** A branch tracking a moving service is rewritten on every release, and it is a node paying verification cost forever.

**R6. A layer AUGMENTS, it never REPLACES.** A layer adds a source, a field or a capability alongside what `main` already does, and leaves the existing path in place. `with/indexer` keeps the direct onchain read and adds the indexed read beside it; view-state fields the indexer contributes are **optional**, so the same view code renders with or without the layer.

This is the rule that makes R1 achievable rather than aspirational. A layer that replaces the direct read would have to edit every call site, which is a `local-signer`-shaped diff and a permanent conflict against every future change to those call sites. A layer that adds an optional field edits nothing, so there is nothing to conflict.

It also removes the need to choose. An app on `with/indexer` still works when the indexer is unreachable, because the direct read never went away, which is R2 satisfied for free rather than by separate effort.

**R5. Verification is per node, regardless of merge cleanliness.** `with/hosted-account` merged with zero conflicts and still shipped a real bug, found only by e2e: under hosted sign-in the wallet list collapses behind a button, so a suite that passed on the parent sat 30 seconds waiting on a control one click further in. Every node touched gets `check`, unit tests and a real e2e run.

## Wave 0: prerequisites, before the first new branch

**0.1 Split `createContext` into named builders.** `web/src/lib/context/index.ts` is 591 lines, one linear function ending in a 27-key object literal, and it is the most conflicted file in the tree (6 of `with/local-signer`'s 65 events). Both a template change and a variant change must always edit it, and both append to the same literal, which is the canonical shape git cannot merge.

At two feature branches this tax lands on roughly one merge in seven and the merge-tax finding reasonably defers the fix. At eight branches it lands on every cascade, on the file where a wrong resolution is a silent runtime bug rather than a type error, because every member looks optional to the compiler once it is in the literal. Adding five layers is precisely the event that makes this non-optional. Pay one contested merge at `with/local-signer` once; afterwards a layer adds a file and one spread.

Choose the section boundaries from where the six conflicts actually landed, not from taste.

**0.2 Decide `variant/offline`.** It is 121 commits behind and participates in no cascade. `with/webevm` may simply supersede it: an in-browser chain is a stronger answer to the same question. Decide and record it either way. Past a certain distance a merge stops being a merge and becomes a hand port, and that distance grows weekly.

**0.3 Clear existing drift** in `bleeps`, `mandalas` and `template-commit-reveal` before adding nodes. They were eight commits behind with conflicts in application source. That is a different job from a template change and must not be entangled with one.

**0.4 Write the layer-shape ADR** (rules R1 to R5 above). One page. Without it, `with/all` becomes five bespoke integrations that happen to share a branch.

## Wave 1: ready now, mutually independent

Nothing here is blocked. All three can proceed in parallel once Wave 0 lands.

- **`with/indexer`** (etherfold). ADR-0002 makes in-browser EIP-1193 indexing the primary axis, so the base case needs no server at all. This is the layer that best fits the template's thesis.

  Built under R6: the branch keeps the direct contract read and adds the indexed read beside it. The worked example is GreetingsRegistry. The indexer records every message an address has sent, and the UI shows a badge on a message saying how many that address has sent in total. That number is unobtainable from a direct read (it is an aggregate over history, which is exactly what an indexer is for), so the badge demonstrates the capability rather than merely re-deriving what the app already had. The view-state field carrying it is optional, absent on `main`, present here.

  Deliberately deferred: whether `main` should carry the indexer outright. Under R6 the question becomes reasonable rather than absurd, because the indexed read would be additive there too and in-browser indexing needs no service. It is still a change to the base every descendant inherits, so it is not part of this plan. Revisit once `with/indexer` has been built and its real cost is known rather than estimated.
- **`with/messaging`** (missiv). Mature; `nodejs`, `bun` and `cf-worker` platforms, so it runs offline.
- **`with/webevm`**. Self-contained and published. Note this layer is subtractive in the dev loop: it removes the local node pane rather than adding one.

**`with/indexer` + `with/webevm` is the flagship.** Chain in the tab, indexer in the tab, the whole stack in one page with no process running anywhere. Build toward it deliberately rather than discovering it, and treat it as the demo the template leads with.

One prerequisite for that pairing, small and upstream: webevm does not put `blockTimestamp` on logs. etherfold reads it from the log where present and otherwise falls back to `eth_getBlockByHash` per block, which ADR-0002 calls the worst-shaped cost in a browser. webevm owns its own log serialization, so this is a small fix in webevm that should land before the two meet.

## Wave 2: sync

**`with/sync`** (synqable client over **waxdb**). synqable's `SyncAdapter` is `pull(account) -> {data, counter}` and `push(account, data, counter)`, which is close to one-to-one with what the service offers. The nodejs platform is what makes the offline story real, and it is inherited from the predecessor.

**The target is `waxdb`, not `secp256k1-db`.** The latter is frozen and archived: its deployment keeps running for apps that cannot be rebuilt, and no fix lands there. waxdb is a new service rather than a migration (its decision 1), so an app moving over starts from an empty record, which is only acceptable because the device is the source of truth and the server is a cache (its decision 2). Both of those are assumptions `with/sync` inherits rather than choices it gets to make, and the second is the one to check against synqable's actual behaviour before building.

The missing ingredient is the signature over `put:${namespace}:${counter}:${data}`, which is what the delegated signer provides. That is why this layer stems from `with/local-signer`.

**The blocker that gated this wave is closed by design, so the wave now waits on waxdb shipping rather than on a fix.** `work/notes/findings/iso-timestamps-make-the-secp256k1-db-signature-ambiguous.md` records why: the predecessor's concatenated message could be re-split when the synced blob contained an ISO-8601 timestamp, which account data routinely does, and that finding is the stated reason waxdb exists. Its replacement encoding is labelled text with a fixed line count, newline-free fields and a hashed payload, so `data` never enters the signed message at all and the only variable-length field is a charset-restricted namespace.

One invariant to carry into the integration, because it is what the whole property rests on: the namespace charset excludes newline, and the message is a fixed line count. Relaxing either brings the ambiguity straight back. If waxdb's conformance suite does not already pin both, that is the regression test to ask for, since a documented invariant with no test is how it gets widened later.

Two design constraints to record while building: the service stores one record per `(address, namespace)`, so sync granularity is whole-document last-writer-wins with no partial sync, and the payload grows with account data. Both follow from synqable's LWW model and are acceptable, but they should be written down rather than discovered.

## Wave 3: notifications, and the upstream work that gates it

`with/notifications` is blocked behind a real chain of work in two other repos. None of it is jolly-roger work, and if notifications are wanted this year it starts before Wave 1 finishes.

**etherfold**: `historical-state-database` (tasked) then `indexer-server-feed` (ready) then `trigger-system` (ready). A state condition is evaluated as of the triggering log's block, which is why the historical-state database lands first.

**push-notification**: GAP-1 (`/push` is unauthenticated, so anyone can notify any address in any domain), GAP-2 (`/register` does not prove address ownership), GAP-3 (`/push` is neither idempotent nor atomic across devices, so an outbox retry re-notifies). Plus a nodejs CLI: it currently ships only `platforms/cf-worker`, and every other service in this plan has a nodejs platform. Without one, the offline story takes a wrangler dependency.

**Shared, and currently unowned by either repo.** Both documents independently ask for a single implementation of "prove address ownership via a registered or delegated signer", used by push-notification's `/register` and by etherfold's trigger registration. push-notification's finding is explicit that this should be one shared implementation, not two similar ones. Name an owner and a home package now; its client half already exists in `with/local-signer`'s delegation code.

## Wave 4: the commit-reveal tree

`with/fuzd` at `template-commit-reveal`, for long-period commit-reveal.

Play modes (hotseat, fixed player set with early advance) are **not** part of this PRD and must not become `with/*` branches. They are mutually exclusive alternatives rather than additive capability, so they are a seam, not a layer. They have their own spec at `docs/plans/play-modes.md` in `template-commit-reveal`, which is on `main` there rather than on a notes branch.

## Cost

jolly-roger goes from 4 live nodes to 10, in a tree that is currently 10 repos and 13 nodes. Six of the new nodes should be `hosted-account`-shaped, which the measurement says costs about one conflict event per eight merges, none in application source. `with/all` pays every conflict the others avoid, by construction; that is what an integration branch is for.

The number that does not shrink is verification: 10 nodes each needing check, unit and e2e. That is the real budget item, and it is the strongest argument for `with/webevm` beyond the demo, since a chain in the tab is what makes a per-node e2e run cheap and hermetic.

## Out of scope

- Designing any individual integration. Each layer gets its own task or spec.
- Play modes and hotseat (separate spec: `docs/plans/play-modes.md` in `template-commit-reveal`).
- Production deployment topology for the services. Each has `platforms/`; how a given app deploys them is the app's decision, constrained only by R3.
- `variant/offline`'s future beyond deciding it (0.2).

## Open decisions

1. ~~Can a branch be both multi-stem and `feature: true`?~~ **Resolved 2026-08-26: yes, verified against the implementation.** `parseBranchGraph` accepts `stem` as a string or a non-empty array, and rejects `feature: true` only when `stem` is absent entirely (the base case). Running this PRD's exact graph through `parseBranchGraph` and `featuresOf`: `with/notifications` is adoptable and carries `{notifications, indexer, local-signer}`, `with/all` carries all seven features, and `website` correctly carries none. No change to offshoot is needed.
2. Who owns the shared address-ownership-proof package, and where does it live?
3. Does `with/webevm` supersede `variant/offline`, or do they answer different questions?
