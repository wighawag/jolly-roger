<script lang="ts">
	import * as Dialog from '$lib/shadcn/ui/dialog/index.js';
	import {type Snippet} from 'svelte';

	interface Props {
		/**
		 * Whether this overlay is OPEN. Prefer not to fold "is my data ready" into
		 * it: a modal that only mounts once its data arrives shows nothing at all
		 * in the meantime, where it should show itself with a loading body.
		 *
		 * It does not affect stacking (that is declaration order; see app.css).
		 */
		openWhen: boolean;
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
		onCancel,
		children,
		elementToFocus,
		focusOnClose,
		...restProps
	}: Props = $props();

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
		Every modal in the app goes into #--layer-modals, the modal LAYER (see the
		layer block in +layout.svelte and the scale in app.css). The layer is a
		stacking context, so this is what puts modals above the drawer, the toasts and
		the notification overlay; the z-50 shadcn puts on the content below only ranks
		modals against each other.

		The target has to be passed to Content, because Content supplies its own portal
		(see shadcn's dialog-content.svelte, which wraps itself in DialogPortal). A bare
		`<Dialog.Portal to="..." />` sibling, which is what stood here, has no children
		and so does nothing at all: the layer div sat empty and every modal was
		portalled to document.body instead. The drawer had the identical bug, and there
		it was visible: it covered every modal, so connecting from inside the drawer
		opened the wallet picker underneath it.
	-->
	<Dialog.Content
		portalProps={{to: '#--layer-modals'}}
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
