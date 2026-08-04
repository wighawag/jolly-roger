<script lang="ts">
	import * as Dialog from '$lib/shadcn/ui/dialog/index.js';
	import {type Snippet} from 'svelte';

	interface Props {
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
	<Dialog.Portal to="#--layer-modals" />
	<Dialog.Content
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
