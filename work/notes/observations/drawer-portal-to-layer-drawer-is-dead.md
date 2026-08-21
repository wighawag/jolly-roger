---
title: The navbar drawer's Portal to #--layer-drawer does nothing
slug: drawer-portal-to-layer-drawer-is-dead
type: observation
status: fixed
created: 2026-08-20
---

> **Fixed 2026-08-20**, once it turned out not to be cosmetic: with the drawer
> open, pressing Connect opened the wallet picker BEHIND the drawer's dimming
> overlay, so the picker was on screen and every click on it went to the drawer.
> `Drawer.Content` now takes `portalProps={{to: '#--layer-drawer'}}`, mirroring
> `modal.svelte`, and `e2e/tests/overlays.e2e.ts` guards it with a trial click.
> The wider audit this prompted is in
> `work/notes/findings/overlay-layer-paint-order-audit.md`.

# `<Drawer.Portal to="#--layer-drawer" />` is dead code

`src/lib/ui/navbar/navbar.svelte` renders:

```svelte
<Drawer.Root ...>
	<Drawer.Portal to="#--layer-drawer" />
	<Drawer.Content ...>
```

The portal element has NO CHILDREN, so it portals nothing. `Drawer.Content` supplies its own portal, exactly as `Dialog.Content` does, so the drawer content lands in `document.body` and `#--layer-drawer` (declared last in `+layout.svelte`, next to `#--layer-modals`) stays empty.

This is the same shape `core/ui/modal/modal.svelte` documents at length having already fixed for dialogs, where the answer was to pass `portalProps={{to: '#--layer-modals'}}` to `Content` rather than render a childless `Portal` sibling. The drawer never got the same treatment.

Observed while writing `e2e/tests/overlays.e2e.ts`: a locator scoped to `#--layer-drawer` found nothing, and the Playwright snapshot showed the drawer's dialog sitting in the body.

## Why it mattered

It was first recorded as a stacking-order risk with the note that "a modal opened from inside the drawer is the case to watch". That case was reported within the day, which is worth remembering: the drawer and the modals share `z-50`, so paint order is DOM order, and a body-portalled drawer is appended AFTER the app div (and so after `#--layer-modals`).

Measured before the fix, with the drawer open and the wallet picker up:

```
drawer-overlay   z=50  body child 2   <- document.body
drawer-content   z=50  body child 3
dialog-overlay   z=50  div > #--layer-modals   (body child 1)
dialog-content   z=50  div > #--layer-modals
elementFromPoint(centre) => div#vaul-svelte-1 [data-slot=drawer-overlay]
```

After: both drawer nodes sit in `#--layer-drawer`, which `+layout.svelte` declares BEFORE `#--layer-modals`, and `elementFromPoint(centre)` returns a button inside `dialog-content`.

The fix mirrors the dialog: drop the childless `<Drawer.Portal>` and give `Drawer.Content` the portal target it already supports.
