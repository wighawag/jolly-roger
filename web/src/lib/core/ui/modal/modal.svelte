<script lang="ts">
	import * as Dialog from '$ui/dialog/index.js';
	import {type Snippet} from 'svelte';

	interface Props {
		/**
		 * Whether this overlay is OPEN. Prefer not to fold "is my data ready" into
		 * it: a modal that only mounts once its data arrives shows nothing at all
		 * in the meantime, where it should show itself with a loading body.
		 *
		 * It does not affect stacking; `layer` and declaration order do. See app.css.
		 */
		openWhen: boolean;
		/**
		 * WHICH LAYER THIS MODAL LIVES IN, and therefore what it can cover.
		 *
		 * The two values are ADR-0004's two kinds of overlay, and the distinction is
		 * the one that predicts stacking:
		 *
		 * - `'modal'` (the default) is a VIEW overlay: the app asking something, or
		 *   showing something, because the user just acted.
		 * - `'system'` is a SYSTEM overlay: visibility derived from domain state
		 *   (`$connection.step`, `$balanceCheck.step`, `$errorDetails`). It is a live
		 *   question about something already in flight, so it must be able to cover
		 *   whatever raised it.
		 *
		 * THIS IS NOT A TIE-BREAK BETWEEN PEERS, which is what declaration order is
		 * for. It is a guarantee across the layout/page boundary, and it exists
		 * because declaration order CANNOT provide one: a page's modals unmount and
		 * remount on every navigation, taking a fresh slot at the end of the layer,
		 * while `AcrossPages` keeps the slot it took when the app started. So the
		 * same two modals stacked one way on a cold load and the other way after a
		 * single navigation. See modal-remount.svelte.test.ts, which pins exactly
		 * that, and the layer block in app.css.
		 */
		layer?: 'modal' | 'system';
		onCancel?: () => void;
		children?: Snippet;
		elementToFocus?: HTMLElement | null;
		/**
		 * Where focus goes once the dialog has closed, in place of restoring it to
		 * whatever opened the dialog.
		 *
		 * Focus is restored after the exit animation, so a caller that closes the
		 * dialog and then focuses something itself loses a race it cannot see. This
		 * runs at the same moment the restore would have, which is the only moment
		 * that reliably wins.
		 */
		focusOnClose?: (() => void) | null;
	}

	let {
		openWhen,
		layer = 'modal',
		onCancel,
		children,
		elementToFocus,
		focusOnClose,
		...restProps
	}: Props = $props();

	const portalTarget = $derived(
		layer === 'system' ? '#--layer-system' : '#--layer-modals',
	);

	let focusedElementWhenOpened: HTMLElement | null = null;
	function onOpenAutoFocus(e: Event) {
		focusedElementWhenOpened = document.querySelector(':focus-visible');
		if (elementToFocus) {
			elementToFocus.focus();
			e.preventDefault();
		}
	}
	function onCloseAutoFocus(e: Event) {
		e.preventDefault();
		if (focusOnClose) {
			focusOnClose();
			return;
		}
		focusedElementWhenOpened?.focus();
	}

	function onInteractOutside(e: Event) {
		e.preventDefault();
		onCancel?.();
	}
	function onEscapeKeydown(e: Event) {
		e.preventDefault();
		onCancel?.();
	}
</script>

<Dialog.Root
	open={openWhen}
	onOpenChange={(open) => {
		if (!open) {
			onCancel?.();
		}
	}}
	{...restProps}
>
	<!--
		Every modal in the app goes into one of two LAYERS (see the layer block in
		+layout.svelte and the scale in app.css): #--layer-modals for view overlays,
		and #--layer-system, one rank above it, for system overlays. A layer is a
		stacking context, so this is what puts modals above the drawer, the toasts and
		the notification overlay; the z-50 shadcn puts on the content below only ranks
		modals against each other WITHIN one layer.

		The target has to be passed to Content, because Content supplies its own portal
		(see shadcn's dialog-content.svelte, which wraps itself in DialogPortal). A bare
		`<Dialog.Portal to="..." />` sibling, which is what stood here, has no children
		and so does nothing at all: the layer div sat empty and every modal was
		portalled to document.body instead. The drawer had the identical bug, and there
		it was visible: it covered every modal, so connecting from inside the drawer
		opened the wallet picker underneath it.
	-->
	<Dialog.Content
		portalProps={{to: portalTarget}}
		interactOutsideBehavior={onCancel ? 'close' : 'ignore'}
		{onInteractOutside}
		escapeKeydownBehavior={onCancel ? 'close' : 'ignore'}
		{onEscapeKeydown}
		{onOpenAutoFocus}
		{onCloseAutoFocus}
		showCloseButton={!!onCancel}
	>
		{@render children?.()}
	</Dialog.Content>
</Dialog.Root>
