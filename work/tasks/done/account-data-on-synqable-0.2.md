---
title: The account data on synqable 0.2 (writes through the handle), its lifecycle, a durable write, and fields an app adds
type: task
status: done
created: 2026-10-28
from: stratagems' port plan, step 8 (`join-template-commit-reveal` branch, `work/plans/join-template-commit-reveal.md`, P8 a, Q8-5, Q8-7, Q8-9 and Q8-10), on synqable 0.2.0 (tag `synqable@0.2.0`, synqable `main` f2704ea, ADR `plans/typed-ready-writes.md`)
---

# The account data on synqable 0.2

## Why

The commit-reveal submission moves into the account data (stratagems' step 8, P8): a turn's secret must be STORED before its commit is sent, by writers no click drives (auto-commit, auto-reveal, the fallback on cycle ticks). synqable 0.2.0 makes a write before the load impossible to express (the mutators moved onto a write handle that only a loaded store gives out). The account data is jolly-roger's, so the move to 0.2 and the three seams the submission needs land here, at `main`, and cascade.

## Done, 2026-10-28, on local preview branches `s8/<branch>`, NOT pushed

On `main` (`s8/main`), one commit each:

1. `82453b71` synqable ^0.0.13 to ^0.2.0. Every write site asks for the current account's handle AT THE WRITE and never keeps one (a handle is revoked by an account switch): `addOperationFromTrackedTransaction`, `updateOperationFromKnownTransaction` and `addTransactionToOperation` still throw "accountData not ready" without one, `addTransactionToOperation`'s read-then-patch is one check on the handle's `read()`; `updateOperationFromTransactionStateUpdated` is silent without one (the observer is fed from this store and re-fed once a store loads); the toast's and the pending-operation inspector's dismissals use `writer()?.removeItem` (that last one, `ui/pending-operation/operation-actions.ts`, is a seventh write site beside the six counted beforehand). `isReady()` is `writer() !== undefined`. The transactions page and the debug list show synqable's new `error` status. `connectors.ts`' comment names "not loaded yet" beside "the account went away" (Q8-7). The stored envelope is unchanged: `stored-operations.svelte.test.ts` passes unchanged.
2. `a03583e5` `lifecycle$: Readable<AccountDataLifecycle>`, `{status: 'no-account'} | {status: 'loading'; account} | {status: 'ready'; account} | {status: 'error'; account; error}` (`account/lifecycle.ts`), following the multi-account store's current store and that store's own `state$`, one emission per change. `createAccountData` takes an optional `storageAdapter`.
3. `deda4087` `writeDurably(write)` (`account/durable-write.ts`): awaits `ready()` (its `StoreUnavailableError` unchanged), pins the store the handle belongs to (`account-switched` if the current store's `writer()` is no longer that handle), runs `write` with every mutator forced `{immediate: true}`, flushes THAT store, and rejects with `AccountDataNotStoredError` (cause: the storage error) when `storageStatus$` reports one, since `flush()` resolves on a failed save.
4. `4121d1fd` `createAccountData({..., fields: {schema, defaults}})` (`account/added-fields.ts`), the schema from `defineSchema`, `operations` not redefinable; `AccountDataStore<F>` assignable to `MultiAccountDataStore`; an added field missing from stored data is filled from its default as the data comes off storage (the store fills nothing for `value` and `record` fields).

Cascaded: `with/local-signer` (one conflict in `AccountData.ts`, both sides kept: the scope-prefix reader and the generic signature), `with/hosted-account`, `with/embedded-chain`, `integration`, `website`, then template-commit-reveal and its games. No node had a write site `main` does not.

**Measured** (check, unit server + client): `main` 0/0, 984 -> 1005 + 44; `with/local-signer` 1251 -> 1272 + 58; `with/hosted-account` 1251 -> 1272 + 58; `with/embedded-chain` 1022 -> 1043 + 46; `integration` 1289 -> 1310 + 60; `website` 984 -> 1005 + 44; every check 0 errors and 0 warnings.
