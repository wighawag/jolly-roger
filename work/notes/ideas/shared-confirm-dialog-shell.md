---
title: A shared ConfirmDialog shell for the confirm/cancel dialogs
slug: shared-confirm-dialog-shell
type: idea
status: decided
resolution: won't-do (the shell already exists as core/ui/modal/basic-modal.svelte)
created: 2026-07-01
decided: 2026-08-21
---

# Shared ConfirmDialog shell

`ConfirmCancelDialog.svelte` and `ConfirmDismissDialog.svelte` (and arguably
other one-off confirm modals) share a shell: a `Modal.Root` with a titled/iconed
header, body copy, a confirm + cancel button pair, and `isSubmitting` /
`errorMessage` handling. Only the icon, title, copy, and confirm action differ.

Idea: a `<ConfirmDialog>` component taking `{open, title, icon?, confirmLabel,
onConfirm, onCancel, isSubmitting?, errorMessage?}` with the body as a snippet.
The two existing dialogs become thin usages.

Deliberately NOT done in the extraction pass: the payoff is moderate and a
too-generic dialog can hurt readability (presentation is often clearer inline).
Worth doing only if a third/fourth confirm dialog appears, at which point the
seam is real. Refs: `src/lib/ui/pending-operation/ConfirmCancelDialog.svelte`,
`ConfirmDismissDialog.svelte`.

## Revisit (2026-08-20)

The trigger condition is about to be met from two directions at once, so this
should be re-decided during slice 1 of `work/prds/proposed/overlay-navigation-model.md`
rather than left incubating.

- Slice 1 rewrites both of these files anyway: they become prompt overlays under
  the registry from ADR-0004, so the shell question is being asked at the moment
  their call sites change.
- Slice 4 adds the third confirm dialog: the confirmation in front of the honest
  escape hatch on a waiting wallet request (`core/connection/connection-flow.ts:285`).

Note what the overlay work does and does not settle. The registry standardises the
STATE side (open/close, history entry, navigation dismissal), which is the part
that was being duplicated across dialogs. It says nothing about the MARKUP side
(header, icon, button pair, `isSubmitting`, `errorMessage`), which is what this
note proposes. So the decision stays a genuine judgement call, just a cheaper one:
if the three dialogs still look near-identical once their state handling is gone,
extract the shell; if what remains is mostly distinct copy, leave them inline.

## Decided (2026-08-21): don't build it, because it is already built

The third dialog arrived with slice 4's escape hatch, so the trigger condition was met and the note was re-read against the actual code rather than against the memory of it. Two things settled it.

**The escape hatch needed no new component.** It is a `BasicModal` (`core/ui/modal/basic-modal.svelte`) with `title`, `cancel={{label, onclick}}`, `confirm={{label, onclick}}` and a paragraph as its body. That component already IS the proposed shell, minus the icon: title, body, confirm/cancel pair, disabled states. It predates this note, which is why the note kept describing a thing that existed.

**What is left in the other two is not shell, it is behaviour.** With state handling gone, `ConfirmDismissDialog` is two icons, two entirely different two-paragraph bodies and a confirm variant that flips between `default` and `destructive` on whether the transaction was dropped; `ConfirmCancelDialog` is three paragraphs including a styled inline warning box, an error box, and `isSubmitting` disabling both buttons while changing the confirm label. Generalising those would mean a shell taking icon, icon colour, confirm variant, conditional confirm label, disabled, and an error slot, on top of a body snippet. At that point the shell has more knobs than the two call sites have differences, and the "too-generic dialog hurts readability" risk this note flagged in the first place is realised rather than avoided.

So: the seam exists and is `BasicModal`; new confirmations should reach for it, as the escape hatch did. The two pending-operation dialogs stay inline because what makes them different is not decoration.

One thing this does NOT settle, and it lands in the cascade: `with/hosted-account` and `with/local-signer` carry `core/ui/confirm/` (`ask(): Promise<boolean>`), which is a different axis, the ASKING protocol rather than the markup. Its doc comment cites this escape hatch as a motivating example, which is now out of date: the escape hatch shipped on `main`, where `ask()` does not exist, and it did not need it. That comment should be corrected when `ask()` is re-expressed on the overlay registry.

