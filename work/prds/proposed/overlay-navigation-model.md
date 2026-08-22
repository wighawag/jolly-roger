---
title: Overlay navigation model (view/system overlays on a navigation capability)
type: prd
status: in-progress
created: 2026-08-20
decides-with: ADR-0004 (docs/adr/0004-view-and-system-overlays.md)
touches-idea: shared-confirm-dialog-shell (work/notes/ideas/)
---

> **Status 2026-08-22: slices 1 to 4 are implemented on `main` and CASCADED.**
> `with/local-signer`, `with/hosted-account` and `website` are all merged, green
> and committed (see "Cascade" at the end). `variant/offline` is 121 commits
> behind and was deliberately out of scope. Nothing is pushed.

# PRD: Overlay navigation model

ADR-0004 holds the decision and the rejected alternatives. This document holds the shape of the work and how it is sliced.

## Problem

Opening the pending-operation modal on `/transactions/` and clicking an address inside it navigates the page and leaves the modal on top of the new one. The user can close it, but it feels wrong because it is wrong: the overlay belongs to a page it is no longer on.

The defect is not local. Three facts make it a template-level concern:

- The modal's state is a module-level global (`web/src/lib/ui/pending-operation/pending-operation-store.ts:28`), so nothing ties it to a route. It is the only overlay in the app whose state is a global, and the only one with this bug. The two facts are the same fact.
- The app already contains a second, hand-rolled answer to the same question: the navbar drawer closes itself with `showMenu = false` in an `onclick` on each of its four links (`web/src/lib/ui/navbar/navbar.svelte:286,342,390,397`).
- Whatever is built here is what adopters copy.

A related latent bug rides along: both openers pass a frozen operation value (`OperationCard.svelte:156`, `toastConnector.ts:125`) and `PendingOperationModal.svelte:36` derives from that snapshot, so a modal left open while its transaction is included, finalized or resubmitted keeps showing stale state.

## Inventory (what exists today)

22 overlay mount points across 11 files.

- **System overlays** (visibility derived from domain state, must survive navigation): 7 in `core/connection/ConnectionFlow.svelte`, plus `NoWalletFlow`, `core/transaction/AccountCannotSendModal`, `ErrorDetailsModal`, `InsufficientFundsModal`.
- **View overlays**: `ui/pending-operation/PendingOperationModal` (content), `ConfirmDismissDialog`, `GasPricingForm`, `ConfirmCancelDialog` (prompts), `ui/navbar` drawer (prompt).
- **Non-dismissable** (no `onCancel`): all in `ConnectionFlow.svelte`, gated by `canDismissConnection()` (`core/connection/connection-flow.ts:294`).

## The model

Per ADR-0004: system overlays keep their current `openWhen={derived domain state}` form and are untouched by the mechanism. View overlays are declared through a registry, in two named kinds with no default, `defineContentOverlay` (URL-bound, survives reload, keyed by id) and `definePromptOverlay` (never in the URL, never restored). Both close on route change and push one ephemeral history entry per level. Everything routes through a `navigation` capability whose SvelteKit adapter is the only `$app/navigation` importer.

## Slices

### Slice 1: the mechanism, and the reported bug

- `navigation` capability + SvelteKit adapter (location stream, navigate, overlay params, ephemeral history entries with tokens).
- View-overlay registry as a context service, with colocated `defineContentOverlay` / `definePromptOverlay` descriptions and `useViewOverlay(def)`, lazily instantiated, no module-level state.
- Close-on-navigate for all view overlays; one history entry per level; conditional entry drop (pop only when our token is still current).
- Dev-only warning when `open()` is called for a definition with no live renderer. The registry owns state only; components keep their own `Modal.Root` markup.
- Migrate `PendingOperationModal` to a content overlay keyed by operation id (payload is the key; the view resolves `accountData.watchItem('operations', key)`), which deletes the global and the stale-snapshot bug. Migrate its three sub-dialogs to prompt overlays.
- Update the ~10 dangling ADR citations to name the `work` branch (first citation per file only; `capabilities/README.md`'s link becomes `work:docs/adr/0001-capabilities-vs-app-context.md`).

**Acceptance (met).** 34 e2e tests pass, including five new ones: two on the drawer (`e2e/tests/overlays.e2e.ts`) and three on the inspector (`e2e/tests/pending-operation.e2e.ts`: opens and addresses the operation, back closes it and drops the param, and it survives a reload). 20 unit tests drive the registry and the service against a fake history stack with the browser's own rules (`test/lib/core/navigation/fake-browser.ts`): entry-drop token logic including a programmatic close after the user navigated on (must not pop), per-level unwinding, closing an overlay closing what it had open on top, `onClose` firing however a prompt is dismissed, deep-link adoption, and retargeting. Two e2e tests (`e2e/tests/overlays.e2e.ts`) drive a real browser: a link inside an overlay navigating closes it, and the back gesture closes it without leaving the page. `pnpm check`, the 474 unit tests, and all 31 e2e tests are green.

Two e2e lessons worth keeping, both about the harness rather than the app: an operation must be observed to exist (the navbar pending badge) before leaving the page, since account data records one only on broadcast; and the navigation to the transactions page has to be CLIENT-SIDE, because account data persists asynchronously and a full reload can discard an operation that was still only in memory. `IMPERSONATE_ADDRESSES` also gained a third dev account, because e2e files that send transactions need one each (`fullyParallel` applies to tests, so the file is `mode: 'serial'` too).

Note the back-after-navigating-away expectation changed once the inspector became a CONTENT overlay, and the change is correct: back returns to `/transactions/?operation=<id>` with the inspector open, because that history entry is "the transactions page showing operation X". Prompts do not come back, since they were questions about an action that is over. The e2e therefore uses the navbar drawer, which needs no wallet or node state, and the inspector's URL binding is covered by the unit tests.

**Found in real use, after the first pass was called done, all fixed:**

- **Landing on a link to an operation showed no modal at all**, while the same URL reached by clicking Inspect worked. The driver was attached in an `$effect`, so the overlay opened DURING hydration, and bits-ui's portal does not mount in that window and never retries. Now attached from `afterNavigate`, which fires after hydration on the initial load too. See `work/notes/findings/overlay-opened-during-hydration-never-renders.md`; the registry also gained a dev-only `globalThis.overlays` introspection hook, which is what turned that hunt into three probes.
- **The inspector auto-closed when its transaction finalized**, because account data drops a finalized operation and the view read "gone" as "close". Raised in review, and it was an unflagged behaviour change: the modal now STAYS OPEN and says the transaction completed. `watchOverlayOperation` distinguishes `cleared` (seen, then removed) from `missing` (never seen, so a stale link), because the two deserve different words.
- **Retargeting an overlay opened from a deep link left the URL behind** (the rewrite was skipped for adopted entries), so a reload showed the wrong operation and the next notification reverted the state. Adopted entries are now re-addressed via `replaceLocation`, which rewrites the URL without claiming an entry that is not ours to pop.
- **Closing several content overlays together dropped only one param**, because each fallback URL was recomputed from the current URL instead of chained.
- **A deep-linked overlay churned on every notification** (close then reopen, visible to subscribers as a flicker, and it dropped a prompt stacked above it), because a token-less entry was read as "everything we opened is behind us". Adopted entries are now left to the URL to decide.

**Found while building, both fixed:**

- **The inspector opened, changed the URL, and showed nothing.** The Kit driver read the current URL from `page.url`, but SvelteKit's `pushState` leaves `page.url` on the route the page is showing (client.js: `history.pushState(opts, '', resolve_url(url))` then `page.state = state`). So the registry read a URL without the param it had just written, concluded the content overlay was not addressed, and closed it. The driver now reads `window.location`, which is what the address bar shows, what a reload would use, and what a hash-based IPFS transition updates. No unit test could have caught this: it is driver behaviour, and the fake browser is by construction consistent. The e2e that now covers it is `e2e/tests/pending-operation.e2e.ts`.
- **Reloading an addressed operation closed it.** Account data is restored asynchronously, so `watchItem` returns nothing for a moment, and the view treated that as "the operation is gone" and closed the overlay. Now tri-stated (`loading` / `missing` / `found`), acting only on `missing`.

**Found while building, both fixed:**

- The open path touched history BEFORE recording the entry, so the registry's own listener met a token the stack did not know, read it as the user having traversed away, and closed every overlay already open. Only visible when opening a prompt from inside a content overlay. Now: record, then navigate (and close in memory, then navigate).
- A first attempt also "fixed" trailing-slash normalization (`/demo` vs `/demo/`) closing overlays. That was a wrong diagnosis of an e2e failure whose real cause was a click swallowed during hydration, which `home.e2e.ts:31` already documents. The speculative code was removed rather than left in as dead subtlety.

### Slice 2: navbar drawer (done)

The drawer is a prompt overlay (`src/lib/ui/navbar/overlays.ts`) and the four manual `showMenu = false` lines are gone. It was the intended proof that the API works outside the feature it was designed for, and it did that: the migration was one import, one `use`, one `registerRenderer`, and deleting handlers.

One pre-existing defect surfaced next to it. It was first left alone as cosmetic, then reported as a real bug the same day and fixed: the drawer's `<Drawer.Portal to="#--layer-drawer" />` has no children and does nothing, so the drawer was portalled to `document.body`, appended after the app, and painted over every modal. Connecting from inside the drawer opened the wallet picker behind the drawer's dimming overlay, where it was visible but not clickable. `Drawer.Content` now takes `portalProps={{to: '#--layer-drawer'}}`, mirroring `modal.svelte`, and `e2e/tests/overlays.e2e.ts` guards it with a trial click (which asserts hittability, not just visibility). See `work/notes/observations/drawer-portal-to-layer-drawer-is-dead.md` and the audit it prompted, `work/notes/findings/overlay-layer-paint-order-audit.md`: toasts (z 999999999) and the notification overlay (z 999) still paint above modals, contrary to the intent stated in `modal.svelte`, and that one is a judgement call rather than an obvious defect.

### Slice 3 (done): one location stream, one framework boundary

**The rule is enforced** by `test/framework-boundary.test.ts`: no `$app/*` under `src/lib` outside `src/lib/kit`, with a `KNOWN_LEAKS` list that is currently EMPTY and that also fails when an entry becomes stale, so it cannot outlive the debt it describes. `src/routes/**` is exempt by definition. `kit/README.md` no longer has to say "not yet enforced".

**Every leak is closed**, each by the lightest seam that fitted:

- `transaction/AccountCannotSendModal.svelte`: `import.meta.env.DEV` instead of SvelteKit's `dev`. Same answer, from the bundler.
- `components/NavigationProgress.svelte` and `ui/navbar/navbar.svelte`: props, as getters (`isNavigating`, `currentPath`), since the layout renders both and reading a getter inside them still tracks `page`/`navigating`.
- `core/metadata/Head.svelte`: a new `document-location` capability. Deliberately NOT the navigation service, and the distinction is the point: navigation is history and stays inert until hydration, while page metadata must be right during SSR, or the canonical URL is one no crawler sees. Asset paths arrive as an `assetUrl` prop from `DefaultHead` (the route capability would have appended global query params to a favicon).
- `core/utils/web/path.ts`: takes a `PathResolver`. `$lib/kit/paths.ts` binds SvelteKit's `resolve()` and re-exports the pre-bound `url()` and `createRouteHandler()`.
- `core/service-worker/index.ts`: a `ServiceWorkerEnvironment` parameter (`resolvePath`, `navigateTo`), with `$lib/kit/notification-navigation.ts` supplying the shallow-routing move for a push notification's action.
- The route capability's fallback no longer resolves base paths, because it cannot: it passes the path through, which is the honest answer when nobody has said where the app is deployed. Every app here provides the real resolver at the root.

**The explorer now reads one location stream.** `createHexLocationParamStore` derives from the navigation service instead of attaching its own `hashchange`/`popstate` listeners, which matters because the value it reads arrives in the FRAGMENT on path-based IPFS gateways and is not a route change. Two tests cover it, including the inert-service case.

**The two remaining "globals" were re-examined and deliberately kept**, with the reasoning written where they live. The evidence changed the plan:

- `lib/deployments-store.ts` holds a BUILD CONSTANT, written only by the dev-only Vite HMR hook in the same file, and read from module scope by nine modules. Threading it through the context would be a large refactor to make a compile-time value look like runtime state. The real defect it did have is fixed: the never-unsubscribed mirror subscription is gone, replaced by an on-demand `get()`.
- `lib/index.ts`'s `serviceWorker`/`notifications` are process-scoped by necessity: `routes/+layout.ts` registers the worker from module scope, before any context exists, because a controlling worker's queued messages are flushed right after `DOMContentLoaded`.

Both now carry a comment stating the test for when module scope is acceptable (genuinely process-scoped, versus belonging to a session, an account or a page), so the next reader does not take them as licence.

### Slice 4 (done): in-flight transaction safety

Persist a pending-request record (account, chain, expected nonce, intent) *before* dispatching to the wallet; reconcile by nonce on startup and after any dismissal, in the terms `core/connection/nonce-cache.ts` already uses; model the outcome as **unknown** until reconciled, never failed or rejected. Then the honest escape hatch that `connection-flow.ts:285` carried as a TODO ("not a Cancel button, which would imply the app can undo what the wallet already has"), whose confirmation is a prompt overlay nested inside a system overlay. Then `guardUnload` on the navigation capability, registered by domain state, firing only for `willUnload` navigations. The prompt is a speed bump; the persistence and reconciliation are the fix.

**The record is written by a wrapped client, not by each call site.** `guardDispatch` (`core/transaction/dispatch-guard.ts`) wraps the tracked wallet client's six sending methods, and the context guards the one client it builds, so every send in the app records itself with nothing to remember. This is the same argument ADR-0004 makes against a `closeOnNavigation(close)` helper: in a template, an opt-in correctness call is one forgotten line away from the failure it exists to prevent, and here the failure is a lost transaction rather than a floating modal. The wrapper is memoised per client, because `executor.ts` documents that transaction tracking identifies clients by reference and a second object is a client nobody listens to. **An app that builds a SECOND tracked client (a local signer, see `buildSignerClient`) has to guard that one too**, which is the one thing this shape cannot do for you, and it is a cascade obligation.

**Settling is by what was OBSERVED, and there is no `failed()`.** A hash drops the record; an EIP-1193 code 4001 drops it, because the wallet said so. Everything else, an RPC that timed out, a wallet that vanished, a promise that never resolved because the tab died, leaves the record for reconciliation. Only one of those three means nothing was sent, and from inside the `catch` they are indistinguishable.

**Reconciliation has three answers, not two.** `recorded` (the app already holds an operation at that nonce, so say nothing and drop the record), `nonce-consumed` (a transaction from this account took that nonce, so it was most likely this one), and `unknown` with a reason. Account data being unreadable for an account is a THIRD state distinct from "no nonces recorded", for exactly the reason ADR-0004 gives for content overlays: collapsing loading into missing reports on a transaction the user is already looking at.

**Acceptance.** `pnpm check` clean, 660 unit tests (up from 512), all 44 e2e green (the `service-worker-gateway` flake surfaced once under a full run and passed 2/2 in isolation, as its note records): four in `e2e/tests/in-flight-transactions.e2e.ts` (seed a record the way a killed tab leaves one, assert the app says something true after a reload) and three in `e2e/tests/escape-hatch.e2e.ts`. Every discriminating test was verified to FAIL against a deliberately broken implementation: recording after dispatch instead of before, dispatching before recording in the guard, holding unload guards on the driver instead of the service, letting a filing failure escape into the send, dropping a marked record on `broadcast()`, and cancelling the connection from the escape hatch.

**One serious bug was found in manual use after this was first called done, and it is worth reading in full** (`work/notes/findings/escape-hatch-cancel-disconnected-and-lost-a-transaction.md`). Stopping waiting called `connection.cancel()`, which in `@etherplay/connect` is a full disconnect: the account went away, so when the user approved in their wallet the transaction landed and `transaction:broadcasted` had nowhere to file it. The app showed "Transaction error: accountData not ready" over a greeting that had posted, and kept no record of the transaction. The feature built to stop the app losing transactions was losing them.

Three fixes came out of it. Stopping waiting now releases the PROMPT (by request id, so the next send is still announced) and leaves the connection alone when a transaction is outstanding, cancelling only when what is held is a connection or signature, where nothing can be lost. A filing failure can no longer escape into the send, which mattered because the tracker's emitter is fail-fast and emits between broadcasting and returning the hash, so a throw there turned a success into a reported failure. And a broadcast that cannot be filed is handed to the ledger as an observed `broadcast-not-recorded` outcome carrying the hash, so the worst case costs the user a line in their transaction list rather than the knowledge that they sent something.

**A second round of the same report** produced three more fixes, all the same shape, the escape hatch releasing the user from one thing while another still held them. The Send button stayed disabled and spinning, because the page was awaiting a dispatch promise that must stay pending so a late approval still records; the guard now follows the REQUEST and the CALLER separately, and stopping waiting rejects the caller with `StoppedWaitingError`, which call sites treat like the other not-really-errors they already handle. The notice said "This transaction may have been sent" about a request from a session that is over, where "this" points at nothing; it now says "A transaction". And reconciliation ran only at startup, before the wallet reconnects, so it could never give the quiet answer and nagged about transactions already in the user's list; `reconcileWhenAccountArrives` adds a pass when an account turns up, and `reconcile()` keeps a trailing pass rather than dropping a request made mid-pass.

**A third round** fixed the reconciliation premise and made three signals agree. Reconciliation could only answer the quiet question for the CONNECTED account, so a reload with a locked wallet could not answer it at all; `readStoredOperations` now reads the account the record NAMES, straight from storage, since the key is derived from the chain, the deployment and the address. And the wallet-action modal, the escape hatch and the unload guard each asked a different question, so they could disagree, which is exactly what was reported ("a modal for the request, but no guard"). All three now rest on `$inFlight.dispatching`: dispatches the app has sent and not yet had answered, which it owns, rather than on `wallet.pendingRequests`, which a wallet state rebuild resets while the request is still outstanding.

**A fourth round** confirmed the cause and closed the last gap. A console log from a real Rabby session shows `wallet.pendingRequests` at 0 while `$inFlight.dispatching` is 1, which settles the earlier hypothesis with data: the library loses the request, and the app is right not to depend on it. Two real bugs came out of the same session. `guardUnload` was a no-op on Chrome and Edge before 119, because the handler set `event.returnValue = ''`, which is the one legacy value meaning DO NOT PROMPT (now `true`, as MDN prescribes); a current headless Chromium honoured `preventDefault()` and so the test passed. And reconciliation ran once and never looked again, so a user who approved AFTER a reload was never told, despite the notice promising that approving later still sends it. `watchUnresolvedRequests` now keeps asking while an outcome could still change (`nonce-free`, `unreadable` and nothing else), backing off 5s to 60s and stopping on its own.

**The reload path recovers a verdict, not a transaction**, and that is now written down rather than implied: after a reload the app never learns the hash, so reconciliation can only say a nonce was consumed. `work/notes/ideas/recover-transaction-by-nonce-binary-search.md` holds the design that would close it (binary-search `eth_getTransactionCount` over block heights for the first block past the record's nonce, then fetch that one block), deliberately not built here.

**The unload prompt report turned out to be a much bigger bug**, found only once that handle existed: **the driver had never attached** (`attached: false` with `guards: 1` and `dispatching: 1`). The service is inert without a driver by design, so the app had no URL updates, no history entries, no back-closes-the-overlay and no unload guard, and NOTHING LOOKED BROKEN, because the registry owns overlay state and prompt overlays work fine without a driver. Attachment no longer hinges on `afterNavigate` alone (a macrotask fallback from `onMount`, after hydration, no-op in the normal case), and the context warns after five seconds if nothing has attached, from the service side so it also catches the adapter component never mounting. See `work/notes/findings/navigation-driver-can-silently-never-attach.md`; why `afterNavigate` did not fire in that session is still open, and it was NOT HMR.

**The navigation seam gained a console handle**, `globalThis.appNavigation`, after three failed attempts to reproduce a report of the unload prompt not firing. `guardUnload` fails silently when no driver attached, which is indistinguishable from the browser declining to prompt. Named `appNavigation` and not `navigation` because the latter is the standard Navigation API object and an accessor with no setter, so assigning it would have thrown during context construction and blanked the app; all three debug handles now assign inside a try/catch.

**Two review rounds landed on top of all this**, and both found real defects. The first caught the escape hatch able to cancel the connection again: `stopWaitingForWallet` judged its branch from `pendingRequests` alone while the control that OFFERED the exit judged it from `dispatchInFlight` too, so in the very state that motivated `dispatchInFlight` it fell through to `cancel()`. Fixed at the root by making `outstandingRequestKind` take `dispatchInFlight` and answer `'transaction'` for it, so the hatch, its copy and its action cannot ask the question differently again. That round also produced: `genesisHash` in the in-flight storage key (a chain id is not identity, and these records are reconciled BY NONCE), age-based pruning so the list is bounded by something other than the user, `readStoredOperations` returning NOT KNOWN rather than `{}` for an envelope it cannot read, a round-trip test through the real synqable store so that envelope drifting fails loudly, and a DEV warning from `createExecutor` when handed a client that does not record before dispatch, which is the `with/local-signer` cascade hazard failing loudly instead of silently.

The second round caught a subtler one: `dispatching` counted from `record()`, which persists and THEN reads a baseline nonce, so "Please confirm the request in your wallet" and its escape hatch could be on screen for up to `baselineTimeoutMs` for a request the wallet had not been asked for. It now counts from an explicit `dispatched()`, called immediately before the send. The same gap had a sharper edge: giving up during that window used to reject the caller and then ask the wallet anyway. The guard now checks `wasAbandoned()` first and, if so, never dispatches and DISCARDS the record, which is the one case where dropping a record is knowledge rather than a guess: we know it was never sent, because we never asked. Also from that round, `readStoredOperations` now tries every spelling of an address (raw, lowercase, checksummed) rather than assuming providers lowercase, since guessing wrong there tells a user a transaction "may have been sent" while it sits in their list.

**The reason it shipped is the more useful lesson.** It passed 40 e2e tests and 581 unit tests because every e2e drives the burner wallet, which answers instantly and is suppressed from the wallet-action prompt entirely, so nothing could stand in the window between dispatch and answer. `e2e/fixtures/stalling-wallet.ts` closes that: a real EIP-6963 wallet that parks `eth_sendTransaction` until the test releases it, and then really sends. A test fixture that cannot enter the dangerous state is a hole in the shape of the danger.

**Verified against a real chain, because the interesting part is not unit-testable.** A headless probe subscribed to the ledger through a real `setMessage` send on a local node and caught the whole sequence: record with no nonce (persisted before anything can fail), baseline `140` patched in 6 ms later, record dropped 60 ms after that when the hash arrived, and the operation landing in account data with nonce `140`. The baseline matching the transaction's actual nonce is the property the entire comparison rests on, and no fake can establish it.

**Two things worth knowing, both written up on this branch.** Without an app RPC the baseline read falls back to the wallet's provider, which fails while disconnected, so reconciliation at startup degrades to "we cannot tell" (`work/notes/observations/in-flight-baseline-needs-an-app-rpc.md`, which suggests re-reconciling when a wallet connects). And the escape hatch inherits the burner-wallet suppression from `hasPendingWalletRequest`, so it cannot be reached in e2e; that is recorded against the predicate that causes it, in `work/notes/observations/wallet-action-required-modal-not-seen.md`.

The `shared-confirm-dialog-shell` idea was decided here rather than left incubating, since this slice supplied its trigger (a third confirm dialog). Won't-do: the shell already exists as `core/ui/modal/basic-modal.svelte`, which is what the escape hatch used.

## Open questions (resolve against real code, not in the abstract)

- The exact `NavigationService` interface. Keep it small: current location, navigate, overlay param read/write, ephemeral push/drop.
- Content-overlay param encoding under `route()`'s IPFS hash rewriting (`path?query#hash`), including whether overlay params should join `globalQueryParams`.
- Where the registry sits inside `Context`.

## Risks

- **The single close path is load-bearing.** Any dismiss route that bypasses `close()` leaks a history entry and makes back appear dead. One place, so it is testable, but it is the thing most likely to be got wrong.
- **A stringly-typed registry would be worse than the status quo.** The bar is that `useViewOverlay(def).open(payload)` is fully type-checked with no casts inside features.
- **Scope creep into slice 4.** The transaction-safety work is where the real danger to users lives, and it is deliberately not in slice 1. Do not let it leak in.

## Cascade (outstanding)

This is a template tree, so `main` is not the whole job. `with/hosted-account` and `with/local-signer` each add two overlays that the model has to absorb, and neither has been touched:

- `lib/core/ui/confirm/` (`confirmation.ts` + `ConfirmationModal.svelte`): a promise-shaped `ask(): Promise<boolean>` with `withdraw()`, rendered from `$confirmation.step === 'asking'`. Under this model it is a PROMPT overlay, and it should be re-expressed on the registry rather than kept as a parallel mechanism: `ask()` opens with the request as payload, `withdraw()` closes, and `onClose` settles the promise `false`. That hook exists for exactly this, and it buys the confirmation the back gesture and navigation dismissal for free. Note its doc comment already anticipates slice 4's "your wallet may still have this request, really stop waiting?".
- `lib/ui/credits/TopUpModal.svelte` (`$topUp.open`, `topUp.dismiss()`): visibility derived from a flow store that can have a wallet request in flight, so it is a SYSTEM overlay and stays as it is.

`variant/offline` and `website` carry no extra overlays, so for them this is a plain merge.

### What slice 4 adds to the cascade (2026-08-21)

**A second tracked client has to be guarded, and nothing can do it for you.** `with/local-signer` (and `with/hosted-account`, which merges it) builds a signer client through `buildSignerClient`, and that client is a different object from the one `lib/context` guards. Unguarded, every transaction sent from the local signer is dispatched with no in-flight record, which is the exact hole slice 4 closes for the account executor. The fix is one call to `guardDispatch(client, inFlight)` inside the factory, INSIDE the memoisation, so one key still yields one object; guarding outside it would produce a second wrapper per call and re-create the untracked-client bug `memoiseSignerClient` exists to prevent. `guardDispatch` is idempotent and carries a brand (`isDispatchGuarded`), so a double guard is safe and the state is checkable.

Signer sends are worth guarding even though no wallet is involved: the danger window is smaller (the app signs locally, so there is no human in the loop) but it is not empty, since the app can still die between `eth_sendRawTransaction` leaving and the hash coming back.

**`core/ui/confirm/` and the escape hatch are two different axes, and neither is the other's home.** The PRD's plan for `ask()` stands: re-express it on the registry as a prompt overlay, with `ask()` opening, `withdraw()` closing and `onClose` settling the promise `false`. What has changed is that its doc comment cites "your wallet may still have this request, really stop waiting?" as a motivating case, and that case has now shipped on `main` WITHOUT `ask()`, as a prompt overlay plus a `BasicModal` whose words come from `escapeHatchCopy` in `core/connection/connection-flow.ts`. Do not rewrite the escape hatch onto `ask()` during the cascade: `ask()` exists only in the descendants, so routing a `main` feature through it would move the feature to the wrong level of the tree. Correct the doc comment instead, and let it cite the real example.

**`TopUpModal` is unaffected, and now for a second reason.** It stays a system overlay, and the wallet request its flow can have in flight is recorded by the ledger like any other, because it goes through a guarded client rather than through the modal.

### Two fixes landed on `main` first (2026-08-21)

Both were found by cascading and both live in `main` files, so they went to their home before the cascade continued rather than being kept where they surfaced. The `with/local-signer` merge was then redone on top of them. A fix left below its home costs a hand-merge at every level forever, and `drift` reports it as a backport candidate until someone does it.

- `ef6bde2` **A connection flow speaks only for the connection it drives.** `name` and `inFlight` are now per flow, with `inFlight` defaulting to an inert ledger.
- `a64e478` **Warn about the signer client too.** The DEV check now also runs on the client `buildSignerClient` returns, deduped per client object.

`main` after both: `pnpm check` clean, 684 unit tests, 44 e2e green.

### `with/local-signer` (done 2026-08-21)

Merged, resolved, and green: `pnpm check` clean, 941 unit tests (up from 920 pre-merge), and the e2e suite passing bar load-sensitive flakes that pass in isolation. Three different suites have now timed out under a full run and passed alone (`service-worker-gateway.e2e.ts:66`, `delegation.e2e.ts:183`, `demo.e2e.ts:48`), which is recorded in `work/notes/observations/delegation-e2e-flakes-under-full-run.md`. The pattern is worth naming: in isolation a transaction-heavy test takes up to 46s, so under a full parallel run these approach the 120s timeout rather than failing on anything the app did.

**Both planned items landed as planned.** The signer client is guarded with `guardDispatch(client, inFlight)` INSIDE `memoiseSignerClient`, and `createConfirmation(overlays)` is now a prompt overlay: `ask()` opens, `withdraw()` closes, `onClose` settles `false`, and the "one at a time" rule retargets the open overlay rather than closing and reopening it, so a question replacing another still costs ONE history entry. The doc comment no longer cites the escape hatch, which shipped on `main` without `ask()`; it cites the top-up flow's own "really give up on a run the wallet may still act on" instead.

Four of the nine new confirmation tests were verified to FAIL against the pre-migration implementation, and they are the four worth having: a navigation, a back press, and a registry teardown each used to leave `ask()` awaiting a promise for the life of the tab, with no dialog on screen to explain what it was waiting for. The other five hold the contract that did not change.

**Three things the plan did not anticipate, all found by running rather than reading:**

- **An app-wide ledger in a per-connection flow.** `ConnectionFlow` read `inFlight` from the context, and this branch renders TWO flows, so the payment connection announced a request belonging to the account connection: two identical "Wallet Action Required" modals, one escape hatch that would release the other connection's caller, and one shared escape-hatch overlay instance because both flows used the same definition label. This is a fifth instance of the recurring question, on an axis the previous four did not have. Fixed by making both per flow (`name`, and `inFlight` defaulting to an INERT ledger so a flow that was not told about one says nothing). Full write-up in `work/notes/findings/one-ledger-two-connections-two-wallet-modals.md`.
- **The DEV tripwire this cascade was told to rely on is blind to the client the cascade is about.** `createExecutor` checks `params.walletClient` and never the client `buildSignerClient` returns, confirmed by probe: unguarded signer client, executor `ready`, zero warnings. `work/notes/findings/executor-dev-warning-does-not-see-the-signer-client.md`. `test/lib/context/signer-client-guard.test.ts` also guards the arrangement in `context/index.ts`, and was verified to fail against both ways it can be got wrong (not guarded, and guarded outside the memoisation).
- **Two different layer schemes met at the merge**, `main`'s `app.css` scale and the descendant's `core/ui/layers.ts`, neither a subset of the other. Reconciled into one (the scale stays in CSS, the list stays in code, a unit test asserts they agree). `work/notes/observations/two-layer-schemes-met-in-the-cascade.md`.

**The e2e suite needed real adaptation, and the reason is the branch's whole point.** This app posts through a LOCAL SIGNER, so the demo page's Send never reaches the user's wallet and a stalling wallet cannot stand in a window that is not there. `escape-hatch.e2e.ts` now drives `/contracts`, which calls the account executor directly, and completes the sign-in step this app requires (the flow parks at `WalletConnected` until the user confirms; skipping it leaves the connection there forever with nothing to stop waiting for). `pending-operation.e2e.ts` now completes the authorisation flow, because a first send from a fresh browser is answered with that flow rather than reaching the chain, so there is no operation to inspect. Two harness lessons worth keeping: an open dialog takes the rest of the page out of the ACCESSIBILITY TREE, so `getByRole` on the page behind it finds nothing while a modal is up; and `/execute/i` does not match "Executing...".

`e2e/impersonate-addresses.json` gained a fourth address and the delegation suite moved to index 3, because this branch has one more transaction-sending suite than `main` and the inspector suite arrived holding the index delegation already used.

### `with/hosted-account` (done 2026-08-22)

A plain merge, and it stayed one: everything the model had to absorb was absorbed a level up, so the guarded signer client and the confirmation-as-prompt-overlay arrive already done. This branch adds a hosted sign-in host and the suite that drives it, not overlays.

Git resolved it with no conflict at all, which is exactly the case the reconciliation skill warns about, and the run said what the merge could not: `escape-hatch.e2e.ts` timed out for 30 seconds on a button that is one click further in here. With hosted sign-in the wallet list shares the modal with email and social options, so `walletEntryMode` collapses it behind "Connect a Wallet" rather than letting it drown them. Fixed one level UP, on `with/local-signer`, so both branches keep one copy of that suite: a forked test file is how two branches stop testing the same thing.

`pnpm check` clean, 941 unit tests, 49 of 50 e2e green (the delegation timeout, 5 of 5 in isolation).

### `website` (done 2026-08-22)

A plain merge with one conflict, in `+layout.svelte`, and it was a union rather than a choice: this branch passes `repoURL` to the navbar, `main` now passes `currentPath` as a getter (the navbar must not import `$app/state` itself) and mounts `<KitNavigation />` above it. The navbar takes both.

`pnpm check` clean, 684 unit tests, 43 of 44 e2e green (the service-worker-gateway flake). Two files on this branch fail prettier and did so before the merge, checked against a stashed tree; they are the branch's own pages and were left alone.

**One thing worth carrying forward, because the content was right and the history was wrong.** Running `git stash` to establish that prettier baseline destroyed `MERGE_HEAD`, so the commit that followed recorded the merged content with a SINGLE parent. Everything built, every test passed, and `git log` said "Merge main into website" at the top, but `rev-list --count website..main` was 8: git believed the merge had never happened, and the next cascade would have re-merged all eight commits and conflicted on every file. Rebuilt with `commit-tree` against the same tree and both parents. The check that catches it is one line, and it is now part of the routine below.

### The cascade is verified as a TREE, not as four separate merges

Per node, after everything landed:

| node | stem | commits of stem not in it |
|---|---|---|
| `with/local-signer` | `main` | 0 |
| `with/hosted-account` | `with/local-signer` | 0 |
| `website` | `main` | 0 |

Nothing is pushed. Every branch is ahead of its upstream (`main` +8, `with/local-signer` +10, `with/hosted-account` +11, `website` +9, `work` +5), deliberately, since publishing was not part of this job.
