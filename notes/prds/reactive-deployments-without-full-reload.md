---
title: Reactive deployments/chain change without a full page reload
type: prd
status: proposed
created: 2026-07-01
supersedes-idea: reactive-deployments-in-gas-fee-store
---

# PRD: Reactive deployments/chain change without a full page reload

## Problem

The context stores are built once from a one-shot `deployments.get()` snapshot,
so when the deployment/chain info changes at runtime they either go stale or
force a full page reload.

Current behaviour (`src/lib/deployments-store.ts` HMR path):

- **Chain id or genesis hash change -> `location.reload()`** (a hard reload).
- **Any other deployments change** (e.g. a contract address) -> the reactive
  `deploymentsWritable.set(newDeployments)` fires, but the stores that closed
  over the OLD snapshot at construction do not observe it, so they keep reading
  the stale contract/chain.

Two stores hold such snapshots today:

- `src/lib/onchain/state.ts` (`createOnchainState`): reads
  `deployments.contracts.GreetingsRegistry` (address + abi) inside its poll
  closure, but from the snapshot captured at construction.
- `src/lib/account/AccountData.ts` (`createAccountData`): derives its
  localStorage key from `deployments.chain.id`, `deployments.chain.genesisHash`
  and the GreetingsRegistry address of the snapshot.

`balance` and `gasFee` take no deployments today (the unused `deployments` param
was removed from gasFee in `d739e31`).

## Goal

Make a deployment/chain change flow through the running app WITHOUT a full page
reload, so switching chains (or a redeploy in dev via HMR) rescopes the live
stores in place. Success = the chain-id / genesis-hash `location.reload()` in
`deployments-store.ts` can be removed (or made opt-in) because the app rebinds
cleanly.

## Why it is tricky (the crux)

This requires a store's SETUP to depend on another store (`deployments`), not
just its per-fetch data. Two shapes to choose between (design-it-twice):

1. **Rescope in place (preferred where possible).** Keep the store instance;
   have it read the CURRENT deployments on each fetch and rescope when a
   deployments-derived key changes. `createPollingStore` already supports this
   via its `source` option (used by `balance`/`signerBalance`): pass a source
   derived from the `deployments` store keyed by
   `chain.id + GreetingsRegistry.address`, and read fresh inside the closure.
   `onchainState` fits this shape almost for free.

2. **Rebuild the sub-tree.** Some stores cannot rescope cleanly because the
   deployments value is part of their IDENTITY, not their data. `accountData`'s
   localStorage key encodes chain id + genesis hash + contract address; changing
   it mid-life means either migrating persisted account data or tearing down and
   recreating the account-data store (and everything wired to it). This likely
   needs a scoped "rebuild the deployment-dependent slice of the context"
   operation rather than an in-place rescope.

So the elegant end state is probably: `createContext` splits into a stable core
(clock, connection, tab-leader) and a **deployment-scoped slice** (onchainState,
accountData, viewState, and any gas config) that can be rebuilt/rescoped when the
deployments store changes, with the composition root subscribing to
`deployments` and swapping the slice.

## The gasFee caveat (do not regress the interface twice)

We deliberately removed `deployments` from `createGasFeeStore` because it was
unused. But gas-estimation CONFIG (e.g. an `expectedWorstGasPrice`, or chain
block-time / percentile tuning) is a natural thing to ship in `deployments.ts`
per chain. If/when that lands, gasFee will WANT chain config again. Design the
reactive-deployments seam so gasFee can opt back in as a CONSUMER of the same
deployment-scoped config source, rather than re-adding a raw `deployments`
snapshot param. i.e. inject a small derived `chainGasConfig` readable, not the
whole deployments object.

## Scope / non-goals

- In scope: onchainState, accountData, viewState re-scoping/rebuild on
  deployments change; removing/relaxing the hard reload; a clean seam for future
  gas config.
- Out of scope (for the first cut): a chain-switcher UI. This PRD is about the
  plumbing that would make such a UI possible without a reload.

## Acceptance (draft)

- Changing `deployments.contracts.GreetingsRegistry.address` at runtime (HMR or a
  test harness that sets the store) makes `onchainState` fetch from the NEW
  address on its next poll, with no page reload, proven by a unit/adapter test.
- Changing chain id at runtime rebinds `accountData` to the correct
  per-chain storage key without corrupting the previous chain's stored data
  (define the migration/teardown contract and test it).
- `deployments-store.ts` no longer force-reloads on chain-id/genesis change (or
  does so only behind an explicit, documented flag).
- No regression: existing 200 unit tests + e2e stay green; the gasFee interface
  is not handed a raw deployments snapshot again.

## Open questions (grill before building)

- Rescope vs rebuild per store: which stores can rescope in place, which must be
  rebuilt? (onchainState: rescope; accountData: likely rebuild.)
- What is the correct behaviour for in-flight operations / pending txs when the
  chain changes under them?
- Does viewState (derived from onchainState + operations) need anything, or does
  it follow for free once its inputs rescope?
- Is a hard reload actually the RIGHT default for a genuine chain switch (safest),
  with reactive rescope reserved for same-chain redeploys? Decide the boundary.

## Refs

- `src/lib/deployments-store.ts` (HMR path, `requiresFullReload`)
- `src/lib/onchain/state.ts`, `src/lib/account/AccountData.ts`
- `src/lib/context/index.ts` (composition root)
- `src/lib/core/connection/polling-store.ts` (`source` option = the in-place rescope primitive)
- `d739e31` (gasFee deployments dep removed), idea note
  `work/notes/ideas/reactive-deployments-in-gas-fee-store.md`
