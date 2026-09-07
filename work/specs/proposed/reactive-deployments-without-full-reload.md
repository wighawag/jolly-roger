---
title: Reactive deployments/chain change without a full page reload
type: prd
status: proposed
created: 2026-07-01
supersedes-idea: reactive-deployments-in-gas-fee-store
carved-out: onchainstate-refetch-on-deployments-change (work/tasks/backlog/)
---

# PRD: Reactive deployments/chain change without a full page reload

## Status: DEFERRED pending a real use case

This PRD was split. The small, unambiguously-worthwhile slice (onchainState
following deployments changes) is carved out as a standalone backlog task
(`work/tasks/backlog/onchainstate-refetch-on-deployments-change.md`) and should
be done independently of this document.

What remains here is the AMBITIOUS goal: let a genuine chain change flow through
the running app WITHOUT a full page reload. The recommendation is to NOT build
this until a concrete use case (a chain-switcher UI, or a multi-chain
requirement) exists, because that use case supplies the design inputs this PRD
currently has to guess at (pending-op behaviour, per-chain history, teardown vs
migration). See "Worth-it assessment" below.

## Problem

Context stores are built once from a one-shot `deployments.get()` snapshot.
Current runtime behaviour (`src/lib/deployments-store.ts` HMR path):

- **Chain id or genesis hash change -> `location.reload()`** (a hard reload).
- **Any other deployments change** (e.g. a contract address) -> reactive
  `deploymentsWritable.set(newDeployments)` fires, but stores that closed over
  the OLD snapshot ignore it. (This is the part the carved-out task fixes for
  onchainState.)

## Goal (deferred)

Make a chain change rescope/rebuild the live stores in place so the chain-id /
genesis-hash `location.reload()` can be removed (or made opt-in) without leaking
stale cross-chain state.

## Why it is tricky (the crux)

This requires a store's SETUP to depend on another store (`deployments`), not
just its per-fetch data. Two shapes (design-it-twice):

1. **Rescope in place.** Keep the instance; read current deployments per fetch
   and rescope on a deployments-derived key change. `createPollingStore`'s
   `source` option already does this. `onchainState` fits (that is the carved-out
   task).
2. **Rebuild the sub-tree.** Some stores can't rescope because deployments are
   part of their IDENTITY. `accountData` (`src/lib/account/AccountData.ts`)
   derives its localStorage key from `deployments.chain.id`,
   `deployments.chain.genesisHash` and the GreetingsRegistry address. Changing
   it mid-life is a data-lifecycle decision (migrate / discard / keep-per-chain),
   not a rescope. This is THE hard part and is underspecified until a use case
   pins the intended behaviour.

Likely end state: `createContext` splits into a stable core (clock, connection,
tab-leader) and a rebuildable deployment-scoped slice (onchainState, accountData,
viewState, gas config), with the composition root swapping the slice on a
deployments change. Every consumer that reads via `getAppContext()` must tolerate
the underlying store instance changing, so this is a cross-cutting change to the
wiring, not a localized one.

## The gasFee caveat (durable constraint, keep even if the rest sits)

`deployments` was removed from `createGasFeeStore` (unused, commit `d739e31`).
But gas-estimation CONFIG (e.g. `expectedWorstGasPrice`, per-chain block-time /
percentile tuning) is a natural thing to ship in `deployments.ts`. When that
lands, gasFee should consume it as an INJECTED DERIVED READABLE (a small
`chainGasConfig`), NOT a re-added raw `deployments` snapshot param. This keeps
the interface deep and makes gasFee a clean consumer of the same
deployment-scoped config seam.

## Worth-it assessment (2026-07-01)

- The reload on a real chain switch is boring and CORRECT: it guarantees no
  stale cross-chain state leaks. Replacing it introduces a class of
  "half-switched app" bugs (one store rebound, another not; a pending tx from
  chain A confirming after switch to chain B). The reload is cheap insurance.
- "Two adapters = a real seam": today there is ONE chain per deployed app and NO
  chain-switcher UI. The reactive-rebuild seam has no second consumer, so
  building it now is speculative generality.
- For a TEMPLATE specifically, an obvious hard reload is arguably the better
  thing to ship than subtle in-place rebinding.

Conclusion: park this behind a real use case. Do the carved-out onchainState task
now; keep the gasFee caveat as a standing design constraint.

## Acceptance (draft, for if/when it is revived)

- Changing chain id at runtime rebinds `accountData` to the correct per-chain
  storage key without corrupting the previous chain's stored data (the
  migration/teardown contract is defined and tested).
- `deployments-store.ts` no longer force-reloads on chain-id/genesis change (or
  only behind an explicit, documented flag).
- In-flight operations / pending txs have a defined, tested behaviour across a
  chain change.
- No regression; the gasFee interface is not handed a raw deployments snapshot.

## Open questions (grill before building)

- accountData on chain switch: migrate, discard, or keep-per-chain-and-switch?
- In-flight operations / pending txs when the chain changes under them?
- Does viewState follow for free once onchainState + operations rescope?
- Is a hard reload actually the RIGHT default for a genuine chain switch (safest),
  with reactive rescope reserved for same-chain redeploys? Where is the boundary?

## Refs

- `src/lib/deployments-store.ts` (HMR path, `requiresFullReload`)
- `src/lib/account/AccountData.ts` (storage-key identity), `src/lib/onchain/state.ts`
- `src/lib/context/index.ts` (composition root)
- `src/lib/core/connection/polling-store.ts` (`source` = the in-place rescope primitive)
- carved-out task: `work/tasks/backlog/onchainstate-refetch-on-deployments-change.md`
- `d739e31` (gasFee deployments dep removed); idea note
  `work/notes/ideas/reactive-deployments-in-gas-fee-store.md`
