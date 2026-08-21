---
title: A shared ConfirmDialog shell for the confirm/cancel dialogs
slug: shared-confirm-dialog-shell
type: idea
status: incubating
created: 2026-07-01
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

