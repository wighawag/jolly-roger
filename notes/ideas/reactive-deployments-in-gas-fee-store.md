---
title: Snapshot-vs-reactive deployments in the context stores (HMR staleness)
slug: reactive-deployments-in-gas-fee-store
type: idea
status: incubating
created: 2026-07-01
---

# Snapshot-vs-reactive deployments in the context stores

Originally: the gas-fee store was created with a one-shot `deployments.get()`
snapshot, so it would keep stale chain config if deployments changed at runtime
(notably via the HMR deployments-store update path in
`src/lib/deployments-store.ts`).

## Update (2026-07-01): gas-fee part resolved, real question relocated

Investigating this showed `createGasFeeStore` never actually READ the
`deployments` it was given: gas estimation uses only `publicClient` (plus the
optional `expectedWorstGasPrice`). So there was no chain config to go stale. The
unused param was removed in commit `d739e31`, which makes the gas-fee angle moot.

The genuine snapshot-vs-reactive staleness question survives in the stores that
DO close over a `deployments.get()` snapshot:

- `src/lib/onchain/state.ts` (`createOnchainState`): reads
  `deployments.contracts.GreetingsRegistry` (address + abi) from the snapshot.
- `src/lib/account/AccountData.ts` (`createAccountData`): builds a storage key
  from `deployments.chain.id`, `deployments.chain.genesisHash` and the
  GreetingsRegistry address from the snapshot.

If the chain/deployment changes mid-session (HMR redeploy, or a future
chain-switch UI), these keep pointing at the old contract/chain. `balance` and
`gasFee` are unaffected (they take no deployments).

## Idea (deferred)

Feed the reactive `deployments` store (or a derived chain-info/contract readable)
into `createOnchainState` and `createAccountData` so they follow deployment
changes, or explicitly document that a deployment change requires a full context
rebuild. Low urgency outside HMR, but it is subtle staleness that surprises
later. Decide per-store: does it want to react, or is rebuild-on-change the
intended contract?

## Promoted to a PRD (2026-07-01)

This grew past an idea: the ambitious version (a chain change that does NOT force
a full page reload) needs a store's setup to depend on another store and a
context-slice rebuild/rescope strategy. Captured as
`work/prds/proposed/reactive-deployments-without-full-reload.md`, which also records
the gasFee caveat (gas config may re-enter via deployments.ts and should come in
as an injected derived readable, not a raw snapshot). Keep this idea note as the
breadcrumb; the PRD is the working document.
