---
title: Overlay paint-order audit (measured), after the drawer-over-modal bug
type: finding
status: resolved
created: 2026-08-20
resolved: 2026-08-20
source: headless-browser probe against a running dev server (computed z-index, DOM position, elementFromPoint) plus a read of every fixed/sticky surface
---

# What is on top of what, measured

> **Resolved 2026-08-20.** Paint order is now one declaration: the `--z-layer-*`
> scale in `app.css`, applied to `[data-layer]` containers in `+layout.svelte`.
> Each layer is a stacking context, so every surface's own z-index became LOCAL
> to its layer, which is why sonner's `999999999` and shadcn's `z-50` could be
> left untouched instead of forked. Our own magic numbers are gone
> (`NotificationOverlay`'s `z-999`, `NavigationProgress`'s `z-9999`). The order
> chosen is drawer < notice < toast < modal < progress, following the intent
> `modal.svelte` had always stated; changing it is now one number.
> `e2e/tests/overlays.e2e.ts` asserts the scale is applied and strictly
> increasing, so a missing rule or a typo'd custom property fails the suite.
> The audit below is kept as the record of what was wrong and how it was measured.

Prompted by a real bug: with the navbar drawer open, pressing Connect opened the wallet picker BEHIND the drawer's dimming overlay, so the picker was visible but every click on it went to the drawer. Cause and fix are in `drawer-portal-to-layer-drawer-is-dead.md`. This note is the audit that came out of asking "what else is ordered by accident?".

## The rule this app plays by

`+layout.svelte` ends with two containers, in this order:

```html
<div id="--layer-drawer"></div>
<div id="--layer-modals"></div>
```

Both are `position: static; z-index: auto` (measured), so they are NOT stacking contexts. Their children are `fixed; z-index: 50`, which means every overlay competes in the ROOT stacking context at the same z, and **paint order is DOM order**. The containers' only job is to make that DOM order deliberate. An overlay that misses its container does not get a slightly wrong z, it gets whatever order its component's position in the tree implies, which is how the drawer ended up above everything.

## Measured inventory

| Surface | Lands in | z-index | Relative to modals |
|---|---|---|---|
| Dialogs (`core/ui/modal/modal.svelte`) | `#--layer-modals` | 50 | baseline |
| Navbar drawer | `#--layer-drawer` (after the fix; `document.body` before it) | 50 | below, correct |
| Sonner toasts | own container in body | **999999999** (svelte-sonner Toaster.svelte:425) | **above** |
| `NotificationOverlay` | in the app div | **999** | **above** (container is `pointer-events-none`, its children are not) |
| `NavigationProgress` | in the app div | 9999 | above, but `pointer-events: none` and a 2px bar: harmless by construction |
| Navbar | in the app div, `sticky` | 50 | below (earlier in DOM), correct |
| Offline / RPC-health / nonce-cache banners | in the app div, `sticky` | 40 | below, correct |
| `DebugOperations` | in the app div | 50 | below (earlier in DOM), correct |
| Popover (`EthereumAvatar`) and Select (contracts page) | `document.body` (shadcn default, no `to`) | 50 | above, **by accident** |

## What is still off, and why it is a judgement call

**Toasts and notifications paint above modals.** `modal.svelte`'s own comment states the intent as keeping modals "above the drawer, the toasts and the notification overlay", and two of those three are not true: sonner pins itself at 999999999 and the notification overlay at 999. Visible when a transaction toast lands while a modal is open, notably on a small screen where the bottom-right toast overlaps a centred dialog, and the toast stays clickable over the dialog's dimming overlay.

It is not obvious this should be "fixed" rather than documented: a toast reporting that a transaction just failed is arguably exactly what should cut through a modal, and the toast connector's own "Inspect" action opens a modal FROM a toast. Both orders are defensible, which is why this is recorded rather than changed.

**Popover and Select portal to the body by default**, which puts them above modals. Today that is what you want (a popover raised from inside a dialog must be above it) but it holds only because the layer containers sit inside the app div and the body-portal lands after it. Nothing states that, and moving the containers would silently invert it.

## If it gets fixed properly

The systematic version is to make the containers real stacking contexts with explicit, named z-indexes (drawer < modals < transient-notice), route the toaster and the notification overlay into the scheme rather than letting each pick its own number, and give popovers a container too. That turns paint order into one declaration in `+layout.svelte` instead of a property of where components happen to sit, and it makes the accidental cases above deliberate. It is a visual-behaviour change (toasts would go under modals), so it wants a decision first.

## How to check any of this quickly

`document.elementFromPoint(innerWidth / 2, innerHeight / 2)` with the surfaces open answers "what would a click hit" directly, and Playwright's `click({trial: true})` turns the same question into an assertion, which is how `e2e/tests/overlays.e2e.ts` now guards the drawer/modal case.
