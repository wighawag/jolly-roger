# In-flight transaction safety

An operation used to be recorded only when the wallet handed back a hash. Between dispatching `eth_sendTransaction` and receiving that hash the app had no record of a transaction that may already be in the mempool, so a reload, a tab crash or a user who stopped waiting left the app believing nothing happened when it may well have. For an app whose next step depends on the first one (a commit expecting its reveal) that is not untidiness, it is data loss.

This directory closes that window. ADR-0004 (`work` branch) holds the decision; this file is the map.

## Removing it

There is no switch, deliberately: a config flag to disable this would be more code than deleting it, and a template should not carry machinery for turning its own machinery off.

It comes out in about twenty minutes, and the shape of that is the point. Delete this directory's `in-flight*` files, `account/recorded-nonces.ts`, and the `inFlight` member of `Context` (`context/types.ts`). Then eight files reference it, and outside the wiring every one is an import plus a line or two:

- `context/index.ts` builds the ledger, guards the client and calls `startInFlightTracking` (the wiring, which is where wiring should concentrate)
- `context/AcrossPages.svelte` renders `<InFlightRequestsModal />`
- `core/connection/executor.ts` warns when handed a client that does not record
- `core/connection/ConnectionFlow.svelte` takes `inFlight` from the context and hands it to `createWalletActivity`
- `core/connection/wallet-activity.ts` reads it, so that stopping waiting releases whatever started the send
- `routes/demo/lib/setGreeting.ts`, `routes/contracts/lib/contractCall.ts` and `ui/pending-operation/operation-actions.ts` (twice) treat `isStoppedWaitingError` as "not a failure"

The dependency runs one way, so deleting it cannot break something upstream. The only app-specific import in the whole subsystem is `InFlightRequestsModal.svelte` reaching for `getAppContext`, and that one goes when the modal does. Removing it puts the app back where this template started: an operation is recorded when a hash comes back, and a reload in between loses it.

## What is here

**`in-flight.ts`** is the rules, and nothing else: the shape of a record, and `reconcileRequest`, which decides what became of one. Pure, so it needs no browser and no node to test. The important thing it does is refuse to guess: there is no `failed` and no `rejected` outcome, because those are things the app can only ever OBSERVE, and a record that reaches reconciliation is by definition one it did not observe.

**`in-flight-store.ts`** is the same rules with the side effects attached: storage, a clock, and the chain reads. `record()` writes to storage BEFORE it does anything that can fail, hang or be interrupted, because the window this exists for is exactly the one where the next line never runs.

**`dispatch-guard.ts`** wraps the tracked wallet client so that recording is structural rather than remembered. Four dispatch sites today and more in any real app; a rule that each must remember to record first is one forgotten line away from the failure it prevents.

**`in-flight-report.ts`** is the wording: what the notice says, and when it says nothing. The wording lives in `.ts` because it IS the feature. This is the app admitting what it does not know, and every variant has to stay truthful under review, which is easier when a reviewer can read them as functions with tests rather than hunt them through markup.

**`in-flight-tracking.ts`** is WHEN to ask again, and what to do about a page that is closing: the startup pass, the one when an account arrives, the backing-off watcher, and the unload guard, started together by `startInFlightTracking`.

**`StoppedWaitingError.ts`** is what a caller gets when the user stops waiting. Not a failure: the transaction may still be sent, and what ended is the await.

**`InFlightRequestsModal.svelte`** renders what `in-flight-report` decides. It contains no policy.

## The three rules worth knowing before you change anything

**Unknown is an answer, and it is the default.** Until a record is reconciled the outcome is unknown. Never failed, never rejected. A rejection is written only when the wallet actually said so (EIP-1193 code 4001). If you find yourself adding a branch that concludes a transaction did not happen, you are almost certainly wrong: the app usually cannot tell a request that failed from one that landed, and saying so is the whole point.

**`undefined` means NOT KNOWN, and is never collapsed into empty.** Account data is per account and restored asynchronously, so "no operations for this account" and "we have not loaded that account" are different answers. Collapsing them tells a user a transaction may have been lost while it sits in their list.

**Settle from what was observed.** A hash settles a record. An observed rejection settles a record. Anything else leaves it: from inside a `catch`, an RPC timeout, a wallet that vanished and a broadcast that was lost are indistinguishable, and only one of the three means nothing was sent.

## Where the rest of it lives

The escape hatch ("your wallet still has this, stop waiting?") is in `core/connection/wallet-activity.ts`, because it is a question about the connection flow rather than about a record. It reads this ledger, and stands down harmlessly when the ledger is inert.

`navigation.guardUnload` is registered by `startInFlightTracking` (in `in-flight-tracking.ts`) from the ledger's own state, never from a modal: the dangerous condition is a request the wallet has and the app has not heard back about, which can be true with no dialog on screen. It is a courtesy and never the safety mechanism, since no dialog survives a tab crash.

## What it does not do

After a reload, reconciliation recovers a VERDICT, not a transaction. The page that dispatched is gone, so the app never learns the hash, and all it can say is whether the nonce it would have used has since been consumed. The transaction does not reappear in the list. `work/notes/ideas/recover-transaction-by-nonce-binary-search.md` (on the `work` branch) has the design that would close that.
