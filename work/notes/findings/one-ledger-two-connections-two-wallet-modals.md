---
title: An app-wide ledger wired into a per-connection flow makes an idle connection claim the wallet is busy
slug: one-ledger-two-connections-two-wallet-modals
type: finding
status: resolved
created: 2026-08-21
---

# The fifth instance of "what is the wallet holding", found by cascading

`wallet-activity.ts` was built so that one question gets one answer. It does that for the three SOURCES that disagree. It did not account for a second axis: an app can have more than one CONNECTION, and the answer is per connection while one of its inputs is per app.

`$inFlight.dispatching` counts every send the app has made and not had answered, wherever it went. `ConnectionFlow.svelte` took `inFlight` straight from the context, so every instance read that app-wide count as though it were a fact about ITS wallet.

On `main` that is invisible: one connection, one flow. `with/local-signer` renders two, because a payment is made on a separate connection and any step needing the user (choosing between installed wallets, approving a connection) must appear for it too:

```svelte
<ConnectionFlow {connection} />
<ConnectionFlow connection={payment.connection} />
```

## What it produced

Caught by `e2e/tests/escape-hatch.e2e.ts` with a strict-mode violation, which is a better report than the bug deserved:

```
strict mode violation: locator('#--layer-modals [role="dialog"]')
  .filter({ hasText: 'Wallet Action Required' }) resolved to 2 elements
```

Two identical "Please confirm the request in your wallet" modals, stacked, for ONE request, one of them belonging to a connection that was idle and had never been asked for anything.

Two things behind that were worse than the duplicate:

- The idle flow offered an escape hatch, and `stopWaiting()` calls `inFlight.stopAwaiting()`, which clears the whole ledger's awaiting map. Stopping waiting on the connection that was NOT waiting would release the caller on the one that was.
- Both flows called `overlays.use(stopWaitingPrompt)`, and an overlay's LABEL is its identity in the registry, so the two shared one instance. Opening the hatch on either rendered the confirmation in both, and closing it in one closed the other.

It did NOT reach the disconnect-and-lose-a-transaction outcome, and the reason is worth recording: `stopWaitingForWallet` reads `outstandingRequestKind`, which answers `'transaction'` for a dispatch in flight and takes the release-the-prompt branch. The fix from the earlier round held the line even for a flow asking about the wrong connection.

## Fixed by making both things per flow

`ConnectionFlow` gained two props:

- `name` (default `'connection'`), which selects the escape-hatch overlay via `stopWaitingPromptFor(name)`, memoised so one key yields one definition object.
- `inFlight`, **defaulting to `inertActivityLedger()`** rather than to the context's ledger. A flow that was not told about a ledger says nothing, which is the safe half of the question. The app opts in the one flow it dispatches through, in `AcrossPages.svelte`, next to the comment saying why.

Regression cover: `test/lib/context/connection-flow-ledger.test.ts`, verified to fail against the pre-fix wiring on both counts (two flows holding the ledger, two flows sharing a name).

## The lesson, which is the one this feature keeps teaching

The previous four instances were all "three sources disagree". This one is "one source, two subjects", and pattern-matching the earlier mechanism would have missed it completely: nothing here combines sources by hand, nothing imports a banned primitive, and `wallet-activity-boundary.test.ts` passes. The question to ask was not "is anyone combining the sources again" but "can anything else produce the same OUTCOME", which is what the earlier round already wrote down.

## Home, and where it landed

`ConnectionFlow.svelte`, `overlays.ts` and `wallet-activity.ts` are all `main` files, and the fix is a no-op there (one flow, and `AcrossPages` passes both props explicitly anyway).

**Landed on `main` (`ef6bde2`, 2026-08-21)** and the `with/local-signer` merge was redone on top of it, rather than being kept on the descendant where it was found. Anything else leaves the fix below its home, so the next variant to add a connection meets the bug again and `offshoot-fanout drift` reports the descendant commit as a backport candidate forever.

`main`'s `AcrossPages.svelte` passes `name` and `inFlight` explicitly even though both defaults would do, which is the cheapest way to make the second flow a variant adds an obvious decision rather than an inherited accident.
