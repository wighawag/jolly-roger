---
title: onchainState follows deployments changes (prompt refetch on contract/chain change)
type: task
status: backlog
created: 2026-07-01
from-prd: reactive-deployments-without-full-reload
---

# onchainState follows deployments changes

## Why

`createOnchainState` (`src/lib/onchain/state.ts`) closes over the
`deployments` snapshot captured at construction and reads
`deployments.contracts.GreetingsRegistry` inside its poll closure. When
deployments change reactively (the `deploymentsWritable.set(...)` path in
`src/lib/deployments-store.ts`, e.g. a contract-address change that does NOT
trip the chain-id/genesis full-reload guard), onchainState keeps reading the OLD
contract. It self-corrects only if/when something else forces it, and never
promptly.

This is the small, localized, deep slice carved out of the reactive-deployments
PRD. It is worth doing on its own; the ambitious "no full reload on chain switch"
work is deferred (see the PRD).

## What (the shape)

Use the polling engine's EXISTING `source` primitive rather than inventing new
machinery. `createPollingStore` already:

- passes the current source value into the `fetch` closure (fresh read), and
- on a source change (by `key`) calls `fetchContinuously()` immediately (prompt
  refetch), via the subscriber set up in `start()`.

So both "read fresh" and "refetch now" fall out of one change:

- Change `createOnchainState` to take the reactive `deployments` store (a
  `Readable<TypedDeployments>` with `.get()`), not a one-shot
  `TypedDeployments`.
- Wire `source: {store: deployments, key: (d) => d.contracts.GreetingsRegistry.address}`
  (key on the contract address; consider `address + chain.id` if a same-address
  cross-chain case is possible).
- Read the contract from the source value inside the closure instead of the
  captured snapshot.
- Update the call site in `src/lib/context/index.ts` to pass the `deployments`
  store (it already has it) instead of `deployments.get()`.

Note: `source` going falsy resets to `Unloaded`; `deployments` is never falsy,
so that branch stays inert here (fine).

## Why fetch-time-only is NOT enough

Reading `deployments.get()` fresh inside the closure without a source would fix
correctness only on the NEXT scheduled poll (up to `fetchInterval` = 5s of stale
data after a switch). Using `source` also triggers an immediate refetch on
change, so the switch is prompt. Do both; `source` gives both.

## Acceptance

- An adapter test: build onchainState over a writable `deployments` store,
  let it load from contract A, then `deployments.set(...)` pointing at contract
  B and assert onchainState refetches from B WITHOUT waiting for the interval
  (drive with fake timers as the other polling-store adapter tests do).
- The contract read inside the closure uses the CURRENT deployments value, not
  the construction-time snapshot (covered by the above).
- `pnpm check` = 0 errors; existing unit tests stay green (test count goes up).
- Behaviour-preserving for the steady state (no deployments change): identical
  polling cadence and output.

## Non-goals

- accountData rescope/rebuild, chain-id/genesis full-reload removal, gas config
  in deployments: all deferred to the PRD. This task is onchainState only.

## Refs

- `src/lib/onchain/state.ts`, `src/lib/context/index.ts`
- `src/lib/core/connection/polling-store.ts` (`source` option, `start()` subscriber)
- `src/lib/deployments-store.ts` (reactive set path)
- `work/prds/proposed/reactive-deployments-without-full-reload.md`
- adapter-test patterns: `test/lib/core/connection/balance.test.ts`,
  `test/lib/core/connection/signerBalance.test.ts`
