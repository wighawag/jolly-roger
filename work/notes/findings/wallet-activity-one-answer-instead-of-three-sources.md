---
title: "Three sources of 'is the wallet holding something' produced a bug twice; now there is one"
slug: wallet-activity-one-answer-instead-of-three-sources
type: finding
status: fixed
created: 2026-08-21
follows: escape-hatch-cancel-disconnected-and-lost-a-transaction
---

# One answer, derived once

Slice 4 ended with three sources of truth for "is the wallet holding something", each legitimate and each incomplete:

- **`wallet.pendingRequests`**, the connection library's list. Authoritative when populated, and reset to `[]` by a wallet state rebuild while the request is still outstanding. A user's console log confirmed it: the list at 0 with a transaction genuinely in flight.
- **`$inFlight.dispatching`**, the app's own count of sends made and not answered. Cannot go missing, starts a beat later, and knows nothing about signature or connection requests.
- **the requests the user has already given up on**, which must silence a prompt without silencing the next request.

Every consumer combined those itself: the modal, the escape-hatch trigger, its copy, the action behind it, and the unload guard. That is five reconciliations of the same three inputs.

## It broke twice, the same way

The escape hatch appeared on the strength of a dispatch, and the code behind it read only the library's list, concluded nothing was outstanding, and fell through to `connection.cancel()`. That is the disconnect-and-lose-the-transaction bug, reintroduced by the change that fixed the modal. It was caught in review rather than by a test, because the tests covered the prompt and the hatch in that state but not the ACTION.

The first occurrence had the same shape: a consumer asking a narrower question than the control that offered the exit.

## The fix

`core/connection/wallet-activity.ts` derives one value from all three sources:

```
{holding, promptUser, escapable, escapeCopy}
```

and owns the action, `stopWaiting()`, so what made the exit appear is what decides what it does. Whether the user is trapped and what to do when they say so are the same decision, and splitting them is what let them disagree.

`ConnectionFlow.svelte` now reads one store instead of combining sources per consumer. `stopped-waiting.ts` folded in: which requests the user gave up on is an implementation detail of "should we prompt", not something a component should hold.

A regression test asserts the property directly rather than the symptom: the action must act on the same answer that was displayed. It fails if the action is given a narrower view than the display, which is exactly how both bugs happened.

## What it cost and bought

`connection-flow.ts` went from 519 lines and 13 exports to 287 and 8, and is back to being what its name says: view helpers for the picker and the sign-in flow. Someone opening it to change the account picker no longer meets transaction-safety policy.

The new module is 362 lines, so this is not a reduction in total volume, and it should not be sold as one. What changed is that the hard part is now in one file whose whole subject is the hard part, instead of spread across five call sites in two files.

`startInFlightTracking` was extracted at the same time, taking the four things that keep the ledger honest (startup reconcile, reconcile on account arrival, the backoff watcher, the unload guard) out of `createContext`. `start()` went from 96 lines to 76. That one is readability only: the four were already correct, they were just assembled in the file every adopter of this template has to read.

## The refactor shipped the same bug a third time, and review caught it

The first version of `createWalletActivity` stashed `latest` and `dispatchInFlight` inside the `derived` callback for the action to read. Svelte's `derived` does not run its callback until something SUBSCRIBES, so on an unwatched store those stayed `{}` and `false`, `outstandingRequestKind` answered `undefined`, and `stopWaiting()` took the connection-cancelling branch. The disconnect-and-lose-the-transaction bug, for the third time, now triggered by a rendering detail: whether anyone happened to be watching.

It worked in the component only because the template reads `$walletActivity`. Every test passed because each called `get(activity)` first, and `get` subscribes transiently. So the tests were not merely silent about the case, they were actively hiding it.

The fix is smaller than the code it replaced: read `get(connection)` and `get(inFlight)` in the action, delete the captured variables and the side effects in the derivation. The action no longer depends on who is looking. A test now calls `stopWaiting()` with no prior `get()`, verified failing first.

Worth sitting with: the module whose entire purpose was to stop this bug class introduced a fresh instance of it, in a new disguise, and neither writing it nor testing it caught that. Both previous instances were "one consumer asked a narrower question"; this one was "the answer was not computed yet". Same outcome, different mechanism, which is why pattern-matching on the previous shape did not help.

## The claim is now a rule

The module doc asserted that a consumer "cannot ask a narrower question than the control that offered it", while all six primitives stayed exported and one test already imported one directly. That is a wish, which is exactly what `framework-boundary.test.ts` says about the `$app/*` rule next door.

`test/wallet-activity-boundary.test.ts` now fails if any `src` file outside `wallet-activity.ts` imports one of them. The primitives stay exported, because they are pure and worth testing one at a time, and tests are exempt for that reason. Its detector is itself tested, after a first version flagged a file whose only import was `createWalletActivity`.

`WalletActivity.holding` was dropped in the same pass: nothing outside tests read it, the kind reaches the user through `escapeCopy`, and a minimal answer with a speculative field is not minimal. The doc now tells the next person to add a field when a consumer needs one.

## And a fourth time, through a door the new rule did not watch

A second review found `dismissable` still outside the store. `canDismissConnection` reads the connection library's request list and nothing else, `ConnectionFlow.svelte` derived `dismissable` from it directly, and every modal wires that to `onCancel={dismissable ? dismiss : undefined}` where `dismiss` is `connection.cancel()`.

So in the one state this module exists for, `escapable` and `dismissable` were BOTH true, and a stray click or an ESC outside the Network Switch modal (the one that can be open post-sign-in with a dispatch outstanding) disconnected with a transaction in flight, bypassing `stopAwaiting()` and the stopped-waiting bookkeeping entirely.

The boundary test could not see it, because `canDismissConnection` is imported from `connection-flow.ts`, not from the guarded module. **The rule watched a file when it should have watched a question.** It now also flags `canDismissConnection` and `hasPendingWalletRequest` imported anywhere in `src`.

`dismissable` is now a field of `WalletActivity`, derived as `!escapable` rather than computed alongside it, so the two cannot disagree about the same moment. A test asserts that they are never both true.

## The invariant that was true only by argument-evaluation order

`stopWaitingForWallet`'s first statement is `inFlight.stopAwaiting()`, which zeroes `dispatching`. The transaction branch therefore survived only because JS evaluates `{dispatchInFlight: get(inFlight).dispatching > 0}` BEFORE the call. Move that read into the body and the branch silently flips to `connection.cancel()`.

Nothing pinned it, because every fake's `stopAwaiting` was `() => calls.push(...)`, leaving the count untouched. The fakes were kinder than the real ledger, so a suite of green tests said nothing about the one ordering that mattered. The fake now zeroes `dispatching` like the real one, and that refactor was confirmed to fail three tests.

## Also hardened

The boundary test cited `framework-boundary.test.ts` as its model and had dropped that file's key safeguard: no assertion that the file list is non-empty, so a wrong cwd would have made the whole rule pass vacuously. It also matched single-quoted imports only (the shadcn tree uses double) and was blind to `import * as`. And its forbidden-list was open by default: a seventh primitive would have been unguarded until someone remembered to add it. It is now an ALLOW-list of the sanctioned surface, so a new export is guarded the moment it exists. Each of the three doors was verified to fail the rule.

## Follow-up, deliberately not done here

`in-flight-view.ts` is now mis-named: its headline export starts timers, kicks reconciliation and registers an unload guard. The drift predates this change and this change made it prominent. Its header now SAYS it has two jobs, and says which split would fix it (`in-flight-report.ts` and `in-flight-tracking.ts`), because a module that quietly does something other than its name is worse than one that admits it. The split itself belongs in its own change rather than riding along with a defect fix. `startInFlightTracking` was at least moved to sit after both parts it composes, instead of between them.

## The general lesson

Two bugs, both from the same cause, and neither would have been possible if the question had one answer. The signal to watch for: **more than one place computing the same fact from the same inputs**. It is not the duplication that hurts, it is that the copies are free to be subtly different, and the difference shows up as behaviour nobody chose.

Worth noting the review found this, not the tests, and not the several rounds of using it. Tests covered each consumer; nothing covered their agreement.
