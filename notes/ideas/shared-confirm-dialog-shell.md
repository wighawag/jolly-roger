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
