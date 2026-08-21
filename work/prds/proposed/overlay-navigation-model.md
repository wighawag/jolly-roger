---
title: Overlay navigation model (view/system overlays on a navigation capability)
type: prd
status: in-progress
created: 2026-08-20
decides-with: ADR-0004 (docs/adr/0004-view-and-system-overlays.md)
touches-idea: shared-confirm-dialog-shell (work/notes/ideas/)
---

> **Status 2026-08-20: slices 1 and 2 are implemented on `main` (uncommitted).**
> Slice 3 and slice 4 are outstanding, and the change has NOT been cascaded to
> the descendant branches yet (see "Cascade" at the end).

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

### Slice 4: in-flight transaction safety (separate work, fresh context)

Persist a pending-request record (account, chain, expected nonce, intent) *before* dispatching to the wallet; reconcile by nonce on startup and after any dismissal, in the terms `core/connection/nonce-cache.ts` already uses; model the outcome as **unknown** until reconciled, never failed or rejected. Then the honest escape hatch that `connection-flow.ts:285` already carries as a TODO ("not a Cancel button, which would imply the app can undo what the wallet already has"), whose confirmation is a prompt overlay nested inside a system overlay. Then `guardUnload` on the navigation capability, registered by domain state, firing only for `willUnload` navigations. The prompt is a speed bump; the persistence and reconciliation are the fix.

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
