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
