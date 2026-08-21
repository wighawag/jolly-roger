---
title: "The escape hatch disconnected the account, and lost the transaction it was built to protect"
slug: escape-hatch-cancel-disconnected-and-lost-a-transaction
type: finding
status: fixed
created: 2026-08-21
source: reported in manual use, reproduced in a headless browser with a wallet that stalls eth_sendTransaction
---

# The feature built to stop the app losing transactions was losing them

Reported: take the escape hatch ("Stop waiting"), confirm it, then approve the transaction in the wallet anyway. An error toast appears; clicking it shows **"Transaction error"** / **"accountData not ready"**. The transaction had succeeded and the greeting was visible in the list.

The reporter diagnosed it in the same breath, and was right: **stopping waiting disconnected the wallet.**

## The chain, confirmed by reading and then by reproducing

1. `stopWaitingForWallet` called `connection.cancel()`. In `@etherplay/connect` that is a full disconnect, not a "stop this request": `popup?.cancel(); deleteLastWallet(); set({step: 'Idle', wallet: undefined, ...})`.
2. The account store goes `undefined`, so the multi-account data store has no current store.
3. The user approves in the wallet. The hash comes back and the tracker emits `transaction:broadcasted`.
4. `account/connectors.ts` calls `accountData.addOperationFromTrackedTransaction`, which throws `accountData not ready` (`AccountData.ts`).
5. The tracker's emitter is **fail-fast** (radiate's `Emitter.emit` only guards listeners when an error handler is registered, and none is), and `emit` is called by `writeContract` **after** the broadcast and **before** it returns the hash. So the throw rejects the send.
6. `setGreeting` catches it and reports `{status: 'error'}`, which becomes the toast and then the modal, quoting an internal state name at the user about a transaction that had in fact succeeded.

Reproduced with a stalling EIP-6963 wallet against a local node. Before the fix, at the moment of confirming: `step: 'Idle'`, `accountDataReady: false`. After approving: the transaction was on chain (`0x268e3b…`) and `OPERATIONS: []`. The app had a real transaction and no record of it anywhere.

## Why it was the worst possible instance of this bug

That outcome, a transaction that landed and an app that has no note of it, is precisely what slice 4 exists to prevent, and ADR-0004 calls "deadly for some applications". The escape hatch created it. The rest of the machinery worked exactly as designed and was helpless, because the record it holds is only useful if the app is still around to settle it.

## Three defects, three fixes

**1. Stopping waiting must not disconnect.** `stopWaitingForWallet` now splits on what the wallet is holding. A TRANSACTION: release the prompt (by request id) and change nothing else, because the user is connected and asked to stop waiting for the request, not for the connection. A CONNECTION or SIGNATURE: cancel the flow, which is safe there since there is no account yet and no transaction to lose.

The prompt is released through a new `stopped-waiting.ts` store keyed BY REQUEST ID, not a flag. A flag would have suppressed the prompt for the *next* send too, which is a worse bug than the one being fixed and would only appear on a second transaction.

It also no longer reconciles in the transaction case. The app stopped BLOCKING, not listening; reconciling would raise "we cannot tell whether this was sent" about a request that is still live and about to settle its own record.

**2. A filing failure must never escape into the send.** The `transaction:broadcasted` listener is wrapped. Given where it runs, a throw there does not skip bookkeeping, it converts a successful broadcast into a reported failure for every caller.

**3. A broadcast that cannot be filed must not be lost.** The listener hands it to the in-flight ledger, which already holds a record for that request and now attaches the hash: a new observed outcome `broadcast-not-recorded`. Reconciliation never overwrites it (watching it happen beats any nonce comparison, and it is the only outcome carrying a hash), and `broadcast()` is a no-op once a record is marked, because the mark arrives moments EARLIER on the same call stack.

So the user now reads: *"This transaction WAS sent (0x…), but the app could not add it to your transaction list, because the account was no longer connected when the wallet answered. It is on chain: look it up by that hash, and do not send it again."*

That path is still reachable by disconnecting by hand mid-request, which is the user's right, and it is now survivable.

## The reason it shipped: the suite could not stand in that window

This got past 40 e2e tests and 581 unit tests. Every e2e drives the burner wallet, which answers instantly AND is suppressed from the wallet-action prompt altogether, so no test could enter the window between dispatch and answer, let alone click something in it.

Closed by `e2e/fixtures/stalling-wallet.ts`: a real EIP-6963 wallet that forwards everything to the node except `eth_sendTransaction`, which it parks until the test approves it, and then really sends. `e2e/tests/escape-hatch.e2e.ts` drives the whole reported flow, and was verified to FAIL against the pre-fix code with exactly the right complaint (`Expected: "WalletConnected", Received: "Idle"`).

`scripts/run-e2e-tests.sh` now passes its arguments through to playwright, so one file can be run without paying for the whole suite. Everything before that point (chain, deploy, build) still happens, because skipping it is how a "quick" run ends up testing the previous build.

## A second round, from the same report

Testing the fix surfaced three more things, all of them the same shape as the first: the escape hatch released the user from ONE thing and left them held by another.

**The Send button stayed disabled and spinning.** Dismissing the modal released the user from a dialog, but the page that started the send was still awaiting the dispatch promise, and that promise must stay pending so a late approval still records. Those two facts had been the same object. Now they are not: the guard keeps following the REQUEST (settling the record whenever the wallet answers, however late) while what it returns to the CALLER also ends when the user stops waiting, rejecting with a new `StoppedWaitingError`. Call sites treat it like the other not-really-errors they already know: stop spinning, say nothing, keep what the user typed.

This matters more than it looks. A wallet is under no obligation to answer a request the user has dismissed, and the reporter saw exactly that: the button recovered when the transaction resolved, and stayed stuck when they cancelled in the wallet. With a fake wallet that sends a proper 4001 the button did recover, so the stuck case is a real-wallet behaviour (dismiss the popup, send no response) rather than something reproducible here. Which is the argument for not depending on an answer at all, rather than for chasing the wallet.

**"This transaction may have been sent" read oddly.** The notice is almost always the first thing seen after a reload, about a request from a session that is over, so "this" points at nothing on screen. Now "A transaction may have been sent", and the lead no longer says "the app asked your wallet to send this".

**On reload it did not reconcile properly.** It reconciled exactly once, at startup, which is before the wallet has reconnected, so the one question with a quiet answer, "does the app already hold an operation at this nonce?", was unanswerable: account data is per account and restored asynchronously. The pass fell back to the nonce comparison and told the user a transaction might have been sent while it sat in their list. Fixed by `reconcileWhenAccountArrives`, plus making `reconcile()` keep a TRAILING pass instead of collapsing a request made mid-pass: every caller is reacting to something that changed, and the running pass started before that and cannot know about it.

Demonstrated in a browser, and the demonstration needed care. The obvious probe (reload with a stale record while the wallet auto-reconnects) does NOT discriminate, because the account is usually already there when the startup pass runs. The case that does is an account arriving LATE: disconnect, reload, then connect. With the fix the notice disappears when the account arrives; without it, it stays for ever.

## A third round: the three signals did not agree

**Reconciliation still did nothing useful on reload.** The quiet answer needs to know whether the app already holds an operation at that nonce, and `createRecordedNonceReader` would only answer for the CONNECTED account. On a reload with a locked wallet no account ever arrives, so it fell back to guessing from the chain and told the user a transaction might have been sent while it sat in their list. Adding `reconcileWhenAccountArrives` had not fixed that, because with a locked wallet there is no account to arrive.

The premise was wrong rather than the timing. Account data is per account, but it is stored under a key derived from the chain, the deployment and the ADDRESS, all of which the in-flight record carries. So `readStoredOperations` reads the account NAMED ON THE RECORD, with no connection at all, and reconciliation stops depending on a session for a job whose whole point is surviving sessions. The live store is still preferred for the connected account, since it may hold writes that have not reached storage yet.

**With a locked Rabby, no wallet-action modal appeared for a transaction being sent, and a reload raised no unload prompt.** Not reproducible here (a fake wallet that returns `[]` from `eth_accounts` makes `ensureConnected` fail with "could not get any accounts" instead of prompting to unlock), but the two reports together point at one cause: `wallet.pendingRequests` is transient library state that a wallet state rebuild resets to `[]` while the request is still outstanding, and unlocking is exactly such a rebuild. The earlier observation note lists that as hypothesis 2 for the unexplained Rabby case.

What could be fixed without reproducing it is the fragility. The modal, the escape hatch and the unload guard each asked a DIFFERENT question, so they could disagree, which is precisely the shape of the report ("a modal for the request, but no guard"). They now all rest on one fact the app owns: `$inFlight.dispatching`, the number of dispatches sent and not yet answered, written immediately before dispatch and cleared only by an answer or by the user giving up.

That was verified by simulating the library losing track mid-request. With `wallet.pendingRequests` emptied while the transaction is still out, all three used to go silent; now all three stay on, and all three go quiet together when the user stops waiting.

## A fourth round: the confirmed cause, and a promise the app was not keeping

**The Rabby hypothesis is now confirmed by data.** A console log from a real session, taken while a transaction was outstanding:

```
WalletConnected connected 0 1
```

Step, wallet status, `wallet.pendingRequests.length`, `$inFlight.dispatching`. The library reports **zero** pending requests while the app knows it is waiting on one. That is hypothesis 2 from `wallet-action-required-modal-not-seen.md`, no longer a guess, and it is why no wallet-action modal appeared. The modal now appears anyway, because it reads the app's own count.

**`guardUnload` was a no-op on many browsers, and the comment claimed the opposite.** The handler did `event.preventDefault()` and then `event.returnValue = ''`. The spec asks the user to confirm when the canceled flag is set OR `returnValue` is not the empty string, so the empty string is the one legacy value that means DO NOT PROMPT. Browsers that predate honouring `preventDefault()` here (Chrome and Edge before 119) look only at `returnValue` and therefore did nothing, while a current headless Chromium prompted correctly and the test passed. Now `event.returnValue = true`, which is what MDN prescribes.

**Reconciliation ran once and never looked again.** Diagnosed by the reporter: "I execute the tx on my wallet AFTER the reload, so maybe the reconciliation only happens once and does not wait?". Exactly right. The notice tells the user, truthfully, that the request may still be waiting in their wallet and that approving it later would still send it. They approved it later, and the app was not watching. Making a promise like that and then not keeping it is worse than staying silent, because the user acts on it.

`watchUnresolvedRequests` keeps asking while an outcome could still change, which is only `nonce-free` (the request may still be with the wallet) and `unreadable` (the chain may come back). Everything else is settled as far as this app can make it, and polling for an answer that cannot change is just load. It backs off 5s, 10s, 20s ... 60s, so the common case is caught quickly and a tab left open on an unacknowledged notice costs almost nothing, and it stops on its own when nothing is left to ask.

Verified in a browser through the reporter's exact sequence: send, reload, THEN approve in the wallet. After the reload the notice reads "the request may still be waiting in your wallet"; fifteen seconds after approving it has become "most likely sent, check your transaction list".

### The probe that lied

The first attempt at that probe showed nothing changing at all, and appeared to show the record surviving with its in-memory dispatch count intact, which is impossible across a reload. The harness was auto-DISMISSING the `beforeunload` dialog, and dismissing that dialog means "stay on the page": the reload never happened. Accepting it changed everything. Two lessons: a probe that produces an impossible reading is telling you about itself, and the unload guard is now load-bearing enough that any test which reloads has to decide what to do with its dialog.

## A fifth round: making the seam answer for itself

The unload prompt was still reported as not firing on a fresh load with a locked Rabby, and it still could not be reproduced: a faithful replay (fresh load, two wallets, picker, a wallet that only yields accounts after an unlock delay, send, reload) raises the dialog every time. Rather than guess a fourth time, the navigation service gained the same dev-only console handle the overlay registry has, `globalThis.appNavigation`, exposing `attached()`, `canGuardUnload()`, `guards()`, `wouldBlockUnload()` and `location()`. `guardUnload` fails SILENTLY when no driver ever attached, which from the outside is indistinguishable from the browser declining to prompt; now one line tells them apart.

**Naming that handle nearly caused a much worse bug.** The first version assigned `globalThis.navigation`, which is the standard Navigation API object (Chrome 102+) that ADR-0004 discusses by name, and which is an accessor with no setter. Assigning to it from a module throws `TypeError: Cannot set property navigation of #<Window> which has only a getter`, inside `createNavigationService`, during context construction: a blank app, in exchange for a console convenience. The reporter's own log contains that exact failure shape for `window.ethereum`, from MetaMask and Rabby fighting over it, which is what prompted the check. It is now `appNavigation`, and every one of the three debug handles (`context`, `overlays`, `appNavigation`) assigns inside a try/catch, because none of them is worth a blank page.

## What to take from it beyond the fix

- **`cancel()` on a connection library is not a dismiss.** Reading what it does took two minutes and would have prevented all of this. Any call that tears down a session deserves that look, especially one wired to a button whose purpose is to be gentle.
- **A safety mechanism has to be tested through the failure it prevents**, not around it. The unit tests asserted the copy, the predicate and the ledger, all correctly, and none of them could see that the feature destroyed its own preconditions.
- **A test fixture that cannot enter the dangerous state is a hole in the shape of the danger.** The burner's instant answers made the suite fast and made this class of bug invisible.
- **"Released the user" is not one thing.** Three separate things were holding them: the modal, the awaited promise behind the Send button, and the connection. Fixing the first two was one report apart, and the pattern each time was the same, so it is worth asking of any escape: what ELSE is this person still attached to?
- **A probe that passes both with and without the fix has not shown you anything.** The first reload probe here did exactly that, and only the late-arriving-account variant proved the change did what it claimed.
- **Three signals about one situation will drift apart.** "Is the wallet holding something?" was answered separately by the modal, the escape hatch and the unload guard, and the bug report was simply the three disagreeing. Deriving all of them from one owned fact removed a whole class of report, and it is worth asking of any UI that reacts to an external system: how many places compute this, and do they all use the same evidence?
- **Prefer evidence you own over evidence you observe.** `wallet.pendingRequests` belongs to a library and is reset by its own state rebuilds. The in-flight record belongs to the app, is written before dispatch, and is cleared only by an answer. Once both were available there was no reason to depend on the fragile one alone.
- **Storage outlives sessions, and so should anything that reconciles them.** Reading account data only for the connected account made a survival feature depend on a live session. The key was addressable all along.
- **A promise made in UI copy is a feature commitment.** "Approving it later would still send it" obliged the app to be watching later, and it was not. When wording tells the user what will happen, something has to be responsible for making that true.
- **Check the exact legacy value, not the shape of the call.** `event.returnValue = ''` looks like the well-known beforeunload incantation and is its opposite. The passing test came from a browser new enough not to need it.
- **An impossible reading means the harness is wrong.** In-memory state cannot survive a reload; seeing it do so was the clue that no reload had occurred.
- **A debug affordance must not be able to break the app.** It runs during construction, on every load, in browsers full of extensions that have already claimed the interesting global names. Assigning one is a side effect on a shared namespace and deserves the same suspicion as any other.
- **Do not take a global name the platform already uses.** `navigation` was chosen because it described the thing, and the platform had got there first. The error it produces is not obviously about a debug handle, so it would have been diagnosed as anything else.
- **When three attempts fail to reproduce, stop reproducing and start instrumenting.** The cost of the console handle was minutes; the cost of a fourth guess was another round trip through someone else's browser.
