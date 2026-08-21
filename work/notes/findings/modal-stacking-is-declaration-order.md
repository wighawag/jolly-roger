---
title: Within a layer, modal stacking is DECLARATION order, not open order
type: finding
status: resolved
created: 2026-08-20
source: component tests against the real Modal/bits-ui components, plus a read of bits-ui's portal and Svelte's mount
---

# Open order buys nothing; the component order decides

Asked while documenting the overlay layers: nested modals share one layer, so what puts a confirmation prompt above the modal that raised it? The comment in `context/AcrossPages.svelte` said a dialog "is appended when it opens", with declaration order as a tie-breaker for dialogs opening in the same tick. That is wrong, and I repeated the error in a first pass at the layer documentation before testing it.

## What actually happens

`bits-ui`'s `Portal` calls Svelte's `mount(PortalConsumer, {target})` from a `watch` on the portal TARGET, not on the dialog's open state. So the consumer is mounted into the layer when the component owning the dialog mounts, and it stays there for that component's lifetime; opening and closing renders content into and out of that fixed slot.

Measured, with both dialogs of a two-modal harness CLOSED: the layer already holds 30 marker nodes, one slot per dialog, before anything has been opened.

Consequences, each pinned by a test in `test/lib/core/ui/modal/modal-stacking.svelte.test.ts`:

- A dialog raised from another is on top **because it is declared after it**, not because it opened later. Inside one component (a modal, then the prompts it raises) and across components alike.
- A modal that closes and reopens returns to its ORIGINAL slot. It cannot jump the stack, which also means a modal whose mounting condition flickers cannot end up above a prompt it raised. An earlier hypothesis that it could was wrong.
- The decisive case: declare the prompt FIRST and open it LAST, and it still paints UNDERNEATH. Timing is irrelevant.

## Why it matters for a template

`AcrossPages.svelte` already depended on this without stating it correctly: `ConnectionFlow` is written last so a wallet picker raised from inside another modal lands on top. That is the only thing keeping it on top, so the file's component order IS the stacking order, and moving a line changes behaviour with no other signal.

The rule now lives in three places that a person actually reads: the layer block in `app.css`, the `openWhen` prop docs in `core/ui/modal/modal.svelte`, and the comment in `AcrossPages.svelte`, each pointing at the test.

## The rule that survived, for a different reason

"`openWhen` should say whether the overlay is open, not whether its data is ready" was originally justified by a stacking hazard that turns out not to exist. It is still worth following, on plain UX grounds: a modal that only mounts once its data arrives shows NOTHING while it loads, where it should show itself with a loading body. `PendingOperationModal` was changed accordingly (reloading a link to an operation now shows the dialog with a spinner rather than a blank page).
