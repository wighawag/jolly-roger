---
title: An overlay opened DURING hydration never renders its dialog
type: finding
status: resolved
created: 2026-08-20
source: headless-browser probes against a dev server (MutationObserver on the modal layer, registry introspection, before/after comparison)
---

# The deep-link case: state says open, nothing renders

Reported: loading `/transactions/?operation=<id>` directly showed no modal, even with the operation still recorded. The same URL reached by clicking Inspect worked.

## What the evidence said

With the page landed on that URL:

- `overlays.states()['pending-operation']` was `{open: true, payload: '<id>'}`.
- `overlays.renderers()['pending-operation']` was `1`, so the modal component WAS mounted and had registered.
- `document.querySelectorAll('[role="dialog"]').length` was `0`, anywhere in the document.
- A `MutationObserver` on `#--layer-modals`, attached before the app booted, recorded NOTHING added. So the dialog was never mounted and then removed; it was never mounted at all.
- The layer element is present in the server-rendered HTML, so the portal's target existed.

The decisive comparison, same page, same URL:

| when the overlay opens | dialogs rendered |
|---|---|
| already open as the component mounts (landing on the URL) | 0 |
| flipped open after hydration (param added later) | 1 |

Removing the param and adding it back, both after hydration, rendered the dialog. So the state, the registry, the portal target and the component were all fine; the only thing that mattered was WHEN the flip happened.

## Cause

The navigation driver was attached in an `$effect`, which runs during hydration. Attaching reports the current location immediately, the registry adopts the URL's content overlay, and the dialog's `open` becomes true while the page is still hydrating. bits-ui's portal does not mount in that window, and never retries: its target is a `$derived` over a non-reactive `document.querySelector`, so a dialog that missed its chance stays unmounted until something toggles it again.

## Fix

Attach the driver from `afterNavigate` instead. It fires for the initial load as well (`type: 'enter'`), after hydration, which is the earliest moment it is safe to say where we are. One consequence worth keeping in mind for anything else built on this seam: **the navigation service is deliberately inert until the app has hydrated**, which is also consistent with ADR-0002's rule that services do no work before mount.

## Why the e2e did not catch it earlier

`pending-operation.e2e.ts`'s reload test covers exactly this path and had been passing, then failed in a reviewer's run: it was timing-dependent, which is what a hydration race looks like from the outside. It now passes deterministically, and it gained a wait for account data to be persisted (a full reload can otherwise discard an operation that was only ever in memory) plus an assertion on the operation's own dialog rather than on any dialog, since a cleared operation now renders one too.

## Aside: the introspection that found it

`createOverlayRegistry` now exposes `globalThis.overlays` in dev (`stack()`, `states()`, `renderers()`), mirroring the app context's existing console affordance. An overlay bug is almost always a disagreement between those three, and having them readable turned this from guesswork into three probes.
