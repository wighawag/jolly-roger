---
title: "\"Wallet Action Required\" modal is never shown for the burner wallet, and unexplained for Rabby"
slug: wallet-action-required-modal-not-seen
type: observation
status: open
created: 2026-08-20
source: headless-browser probes against a dev server, with eth_sendTransaction stalled to hold a wallet request pending
---

# Two separate things behind "I never see that modal"

Reported: sending a message while disconnected, choosing Rabby, then sending, shows no "Wallet Action Required" modal (`core/connection/ConnectionFlow.svelte:497`), in that session even after connecting; after a page reload, still connected, the modal appears.

Probed by stalling `eth_sendTransaction` at the network layer (never forwarded, so no transaction is broadcast) and reading the connection store and open dialogs over time.

## Confirmed: with the BURNER wallet, the modal never appears at all, by design

State was correct throughout (`wallet.pendingRequests` held one `eth_sendTransaction` for the whole stall) and no dialog opened, both before and after a reload.

The cause is `hasPendingWalletRequest()` (`core/connection/connection-flow.ts:307`), which suppresses the prompt when `isBurnerWalletInSelectionPhase()` is true. Despite the name, that predicate is not about a selection phase at all:

```ts
state.step !== 'Idle' &&
state.step !== 'MechanismToChoose' &&
state.mechanism?.type === 'wallet' &&
state.mechanism?.name === 'Burner Wallet'
```

Every step from `WalletToChoose` onwards satisfies it, so for the burner the answer is always "suppress", not "suppress while choosing". The intent is sound (a burner needs no human confirmation, so a prompt asking for one would be a lie) and the code already carries a TODO to replace it with a generic signal such as a provider-level `requiresNoUserConfirmation`. Worth doing: the current shape means the name misleads, and any future auto-approving wallet has to be added to a hardcoded name check.

This likely explains "I spotted it once": the one sighting would have been the non-burner wallet.

### Consequence for slice 4's escape hatch (2026-08-21)

The escape hatch inherits this suppression, because it had to. `offersEscapeHatch()` is defined as `!canDismissConnection()`, deliberately, so that a step which refuses dismissal always gains an exit and the two lists cannot drift. `canDismissConnection` ends in `!hasPendingWalletRequest(state)`, so the burner suppression flows straight through: with the burner wallet there is no "Wallet Action Required" modal AND no "Stop waiting" button on it.

That is arguably right on its own terms (a burner answers instantly, so there is nothing to stop waiting for), but it had a cost that turned out to be expensive: **the escape hatch could not be covered end to end by the e2e suite**, because the burner was the only wallet a headless run had. A bug that disconnected the wallet and lost a real transaction shipped straight through that hole; see `work/notes/findings/escape-hatch-cancel-disconnected-and-lost-a-transaction.md`.

**Resolved for testing purposes (2026-08-21), though not at its root.** `e2e/fixtures/stalling-wallet.ts` injects a real EIP-6963 wallet that is not the burner, so it is not suppressed, and that parks `eth_sendTransaction` until the test approves it. `e2e/tests/escape-hatch.e2e.ts` now drives the whole window. The predicate itself is unchanged and still misnamed, and replacing it with a provider-level `requiresNoUserConfirmation` remains worth doing on its own merits.

## Not reproduced: the Rabby case

With an injected EIP-6963 wallet that behaves like an extension (answers reads, never answers `eth_sendTransaction`), the modal appears correctly in all three paths, including the exact reported one:

- connect first, then send: modal appears;
- send while DISCONNECTED, connect through the flow the send raised, then send: modal appears;
- after a reload: modal appears.

Emitting `accountsChanged` and `chainChanged` while the request was pending (a plausible Rabby behaviour, since a state rebuild resets `pendingRequests: []` in @etherplay/connect) did not break it either.

So the app-side plumbing (tracked provider -> `wallet.pendingRequests` -> `hasPendingWalletRequest` -> modal) is sound for a normal wallet, and something Rabby-specific remains unexplained. Next step is data from a real Rabby session rather than more guessing: with the dev build, `globalThis.context` and `globalThis.get` are exposed, so a one-liner in the console can log `step`, `mechanism.name`, `wallet.pendingRequests` and the open dialog titles once a second while reproducing.

### CONFIRMED (2026-08-21): the library loses the request, the app no longer depends on it

A second report from real use: **with a locked Rabby, no modal appeared for a transaction being sent**. A console log from that session settles it. While a transaction was genuinely outstanding:

```
step                wallet.status   pendingRequests   inFlight.dispatching
WalletConnected     connected       0                 1
```

The library reports **zero** pending requests while the app knows it is waiting on one. That is hypothesis 2 below, confirmed with data rather than argued: the request does reach the provider, and `wallet.pendingRequests` does not survive whatever the unlock does to the wallet state. So this was never a rendering problem.

Rather than wait to confirm it, the app stopped depending on that field alone. The wallet-action modal, the escape hatch and the unload guard now also consult `$inFlight.dispatching`, the app's own count of dispatches sent and not yet answered, which is written immediately before dispatch and cleared only by an answer or by the user giving up. Verified by emptying `wallet.pendingRequests` mid-request: all three used to go silent, and now all three stay up.

What remains open is the library-side detail: WHICH transition empties the list, and whether that is worth reporting upstream. The app is no longer affected either way, so this is now a tidiness question rather than a user-facing one.

The two hypotheses this was tested against:

1. `mechanism.name` is not what we think during that session (if anything ever reports `Burner Wallet` while Rabby is connected, the suppression above fires and everything follows).
2. The request never reaches the tracked provider, so `pendingRequests` stays empty (state problem), as opposed to the modal failing to render (view problem). The log distinguishes these two immediately.

### Consequence for the sending indicator, and why `main` keeps it (2026-08-26)

Raised while deciding whether `main` needs the sending indicator at all, on the reasoning that it already has the "Wallet Action Required" modal. It does not, and this suppression is why.

Because `isBurnerWalletInSelectionPhase` is true for the burner at every step past selection, `shouldPromptForWalletAction` returns false for the whole life of a burner session, dispatches included. So `main` has a SILENT SEND PATH: with `?burner=true` (or the dev accounts), a transaction goes out with no modal, exactly as it does with a local signer on `with/local-signer`. The unload guard still arms, because it is derived from `$inFlight.dispatching` and knows nothing about mechanisms.

That settles a question that looked like a `main`-versus-variant judgement call. `sendingIndicator` stays `'floating'` at `main` (6d6711d): turning it off there would restore the unexplained blocking dialog for the burner, which is the path the template is most used on in development. It is `template-comit-reveal` and other descendants with their own in-flight affordance that should set `'none'`.

Worth noticing that this predicate has now shaped three separate things: the modal a user never sees, an escape hatch the e2e suite could not reach (which is why `e2e/fixtures/stalling-wallet.ts` exists), and now a UI decision about a different surface entirely, made two branches away by someone reasoning from the modal's apparent presence. Each time the cost was the same: the name says "while choosing" and the behaviour is "always, for this wallet", so the call sites read as narrower than they are. The replacement is still the provider-level `requiresNoUserConfirmation` signal the TODO already names.

Unrelated to the predicate, recorded here because it came out of the same work: `e2e/fixtures/stalling-wallet.ts` now holds a POOL of accounts with a `stallingAccountIndex` claim per suite, rather than one address. The one-address version was fine while one suite used the fixture, and the second suite that needed the dispatch window turned it into a nonce race. `test/e2e-account-claims.test.ts` checks those claims the way it already checked `walletAccountIndex`.

### ANSWERED (2026-08-31): the transition is `connect()`, reached by the locked-wallet path, and it is fixed upstream in 0.10.0

The open question above, "WHICH transition empties the list", has an answer, and it was an ordinary path rather than an exotic one.

Every wallet-state rebuild inside `createConnection` asserted `pendingRequests: []`. That erased an outstanding request, and erased it PERMANENTLY, because the store writes that list only on request events and the next event for a request is the one that ends it. Nothing ever put it back. The transition that fires it is `connect()`: a send against a LOCKED wallet raises the connection flow, so `connect()` runs while the wallet is still holding the transaction and rebuilds the state underneath it. That is exactly the locked-Rabby session logged above. The wallet event handlers were never at fault, which is why emitting `accountsChanged` and `chainChanged` by hand (the "Not reproduced" section) failed to reproduce it: `onChainChanged` and `onAccountChanged` spread the existing state and always preserved the list.

`@etherplay/connect@0.10.0` copies the live list from the provider wrapper at every rebuild instead of asserting an empty one, so a request now stays announced across a reconnect and still clears when the wallet answers. The same release routed `getDelegation` and `getSignatureForPublicKeyPublication` through the wrapper, which fixes a second, separate symptom: those two signatures were signed above the tracking wrapper and never appeared in `pendingRequests` at all, which is why "Buy an avatar" in reveal-or-die popped a signature request with no modal behind it.

**What this app now does about it.** The app is on 0.10.0, and the ledger STAYS. It was never only a workaround: it also covers dispatches signed by a local signer, which no wallet is ever asked about and which therefore cannot appear in a list of wallet requests, and it starts a beat before the wallet is handed anything. What changed is the precedence and the justification, recorded in `docs/adr/0008-the-ledger-answers-a-different-question-from-the-library-list.md`. The stale "the list goes missing" reasons in `core/connection/wallet-activity.ts` and `core/transaction/in-flight-store.ts` are gone, because leaving them is how the next reader concludes the workaround is load-bearing when it is not.

**Now covered end to end**, in the window this note says the burner could never reach. `e2e/tests/escape-hatch.e2e.ts` gained "survives the reconnect that used to erase the request": it parks a transaction in the stalling wallet, locks the wallet, re-enters the flow, and asserts that the library's list still holds the request AND that the modal, the escape hatch and the unload guard all stay up, then that all of them go away when the wallet answers. Pinning `@etherplay/connect` back to `0.7.1` fails it with `expected 1, received 0`, so it is a regression test rather than a description. The fixture gained a real listener registry and `lock()`/`unlock()` to make the transition reachable at all; `on` was previously a no-op, which is why no test could stand in a wallet-state rebuild.

#### Still wrong from this side, and worth reporting upstream

Found while building that test, both the same class of bug as the one just fixed, through a different door: a `wallet` object that is not rebuilt but REMOVED.

1. **`connect()` on a locked wallet tears the wallet down instead of reconnecting.** The `forceConnect` branch that reuses the existing mechanism lives in `ensureConnected`, not in `connect`. Calling `connect()` with no mechanism while `step` is `WalletConnected` and `wallet.status` is `locked` goes to the wallet PICKER: observed landing on `WalletToChoose` with `wallet: undefined` and the mechanism's `name` dropped, with a transaction still parked in the wallet and no error set. This is reachable in this app today, because the navbar's Connect button is `connection.connect()`. From the consumer's side the two entry points differ in a way nothing announces, and the more obvious one is the destructive one.

2. **`wallet: undefined` sidesteps the 0.10.0 fix.** That fix copies `getPendingRequests()` at every `wallet: {...}` construction, which is right, but several paths set `wallet: undefined` rather than constructing one: twice inside `connect` while it waits for accounts, and in `setConnectionFailure`, whose comment explains that a failed attempt must not keep routing requests through the failed wallet. Fair for reads, but it also removes the only announcement of a request the wallet is still holding, and after a FAILED reconnect it is not transient. The list survives inside the wrapper; there is simply nowhere left to read it from. Worth considering whether the pending list belongs on the wallet object at all, or beside it.

Neither is user-facing here, because the app's own ledger keeps the modal, the escape hatch and the unload guard up through both. That is the concrete demonstration that deleting the ledger on the strength of the upstream fix would have been wrong: case 1 was observed producing exactly the old symptom, with the app's own signal the only thing left holding the affordances up.

### CLOSED UPSTREAM (2026-08-31): 0.11.0 answers both follow-ups, one by fixing it and one by refusing to

Both items in the previous block are resolved, and the second one is more interesting than the first because it was resolved by being told no.

**The `wallet: undefined` hole is fixed, at the root rather than at the call sites.** `pendingRequests` moved OFF the wallet object and onto the connection itself. It is now stamped inside `set()`, which is the single place a published state is built, and `ConnectionInput` does not carry the field at all, so a construction site cannot supply a wrong one and none has to remember to copy one. The 0.10.0 rule ("copy the list at every `wallet: {...}` rebuild") held at nine sites and was never going to hold at the tenth, and the tenth kind of site was the one that builds no wallet at all, which was not a call site so could not be audited. `wallet.pendingRequests` survives as a deprecated mirror, stamped from the same read so the two cannot drift while consumers migrate.

**The `connect()` versus `ensureConnected()` asymmetry was NOT a bug, and is now documented as a decision.** Upstream's `docs/adr/0002-connect-ensure-connected-and-unlock-are-three-promises.md` records three distinct promises: `connect` drives the flow from the user's CHOICE, so a bare `connect()` opens the picker even from a state that already has a wallet, which is how a switch-wallet button works; `ensureConnected` promises a TARGET, so it alone reconnects a locked wallet by replaying the mechanism; and `unlock()` is the narrow remedy in between, which prompts the wallet and KEEPS the step, the account and the wallet. What made the picker look destructive from here was the OTHER defect, not the asymmetry: the teardown also erased the announcement of whatever the wallet was still holding. It no longer does, so the picker costs a click and nothing else. The report was right about the symptom and wrong about the cause, which is roughly the best a consumer-side report can do.

Three more defects were found upstream while fixing those, none of which were visible from here and all of which would have been: `disconnect()` used to unsubscribe the request-event listener, which silenced request announcements for the rest of the connection's life since nothing re-subscribes, so a disconnect followed by a reconnect left an app blind to every subsequent wallet prompt; two of eleven wallet-less states forgot to tear the wallet down, so the wrapper kept SIGNING for a state showing no wallet; and a locked-wallet reconnect replays the mechanism's address, so a user who unlocked on a DIFFERENT account hit a throw that landed in the catch and tore the wallet down, meaning the reconnect performed the very teardown it exists to prevent.

**What the app did.** Took `^0.11.0` and migrated the read from `state.wallet.pendingRequests` to `state.pendingRequests`. That is a floor rather than a preference: reading `state.pendingRequests ?? state.wallet?.pendingRequests` would restore the exact ambiguity the move removed, where an empty answer means either "nothing is outstanding" or "this state has no wallet to ask", so the app reads only the new field and fails loudly against an older one. `ConnectionStateSnapshot` gained a type-level assertion, because the claim in its own doc comment ("a rename upstream fails the typecheck here") was FALSE for every re-declared field: they are all optional, so the real `Connection` stays assignable after upstream drops one and the app would read `undefined` for a request the wallet is genuinely holding. Verified by narrowing the snapshot's `kind` and watching it fail.

`e2e/tests/escape-hatch.e2e.ts` gained "keeps announcing a request through a state with NO wallet", which parks a transaction, locks the wallet, drives the picker path through `connect()`, asserts the flow rests on `WalletToChoose` with no wallet, and asserts the request is still announced and all three affordances still up. It fails on 0.10.0. The picker path is the app's own navbar Connect button, so this is a real user route rather than a constructed one.

One consumer-side follow-up is now open, and it is a UI question rather than a correctness one: upstream publishes `wallet.status` precisely so an app can offer "Unlock" rather than "Connect" when it says `locked`, and this app's navbar offers Connect unconditionally. Taking the picker on a locked wallet is now merely a wasted click, so this is polish, not a defect.
