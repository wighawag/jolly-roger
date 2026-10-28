---
title: the pending-operation inspector says "loading" for ever when the account data failed to load
slug: pending-operation-inspector-says-loading-forever-on-a-load-error
type: observation
status: resolved
created: 2026-10-28
---

# The inspector reads readiness, not the lifecycle

`web/src/lib/ui/pending-operation/overlays.ts` sets `{status: accountData.isReady() ? 'missing' : 'loading'}` on every emission of `watchItem`. Since synqable 0.2 a failed load is its own status (`error`), and `isReady()` is false there, so an inspector opened on an account whose data failed to load shows "loading" and never anything else. Before 0.2 the same happened (the failure was `idle` with a `loadError`).

Found while moving the account data to synqable 0.2 (task `account-data-on-synqable-0.2`); left as it was, because the fix is a new state in the overlay and its modal, not a migration. The account data now has `lifecycle$` (`no-account`, `loading`, `ready`, `error` with its error), which is what the overlay should derive from: `error` becomes a third outcome beside `missing` and `loading`.

**Resolved, 2026-10-28** (`852071b5` on `main`, cascaded): the inspector has a fifth state, `{status: 'unavailable'; key; error}`, read from `lifecycle$` (entering or leaving `error` re-evaluates, since `watchItem` and the lifecycle listeners are not ordered), and the modal says the transactions could not be loaded, with the error. Tested in `test/lib/ui/pending-operation/inspected-operation.test.ts`.
