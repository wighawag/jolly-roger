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

## Not reproduced: the Rabby case

With an injected EIP-6963 wallet that behaves like an extension (answers reads, never answers `eth_sendTransaction`), the modal appears correctly in all three paths, including the exact reported one:

- connect first, then send: modal appears;
- send while DISCONNECTED, connect through the flow the send raised, then send: modal appears;
- after a reload: modal appears.

Emitting `accountsChanged` and `chainChanged` while the request was pending (a plausible Rabby behaviour, since a state rebuild resets `pendingRequests: []` in @etherplay/connect) did not break it either.

So the app-side plumbing (tracked provider -> `wallet.pendingRequests` -> `hasPendingWalletRequest` -> modal) is sound for a normal wallet, and something Rabby-specific remains unexplained. Next step is data from a real Rabby session rather than more guessing: with the dev build, `globalThis.context` and `globalThis.get` are exposed, so a one-liner in the console can log `step`, `mechanism.name`, `wallet.pendingRequests` and the open dialog titles once a second while reproducing.

Two hypotheses to test against that data:

1. `mechanism.name` is not what we think during that session (if anything ever reports `Burner Wallet` while Rabby is connected, the suppression above fires and everything follows).
2. The request never reaches the tracked provider, so `pendingRequests` stays empty (state problem), as opposed to the modal failing to render (view problem). The log distinguishes these two immediately.
