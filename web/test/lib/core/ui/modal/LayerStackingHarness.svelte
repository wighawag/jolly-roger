<script lang="ts">
	// THE REAL SCALE, not a copy of it, so renumbering app.css is caught here.
	import '../../../../../src/app.css';
	import * as Modal from '$lib/core/ui/modal/index.js';

	/**
	 * The shape of the bug: a SYSTEM modal, and a modal opened FROM it that is
	 * declared after it, exactly as `context/AcrossPages.svelte` declares the
	 * top-up modal after the insufficient-funds modal.
	 *
	 * `raisedLayer` is what the raised modal claims, so one harness can render
	 * both the broken arrangement and the fixed one.
	 */
	let {
		systemOpen = false,
		raisedOpen = false,
		raisedLayer = 'modal' as 'modal' | 'system',
	} = $props();
</script>

<!-- Both layers, in the order +layout.svelte renders them. -->
<div data-layer="modal" id="--layer-modals"></div>
<div data-layer="system" id="--layer-system"></div>

<Modal.Root layer="system" openWhen={systemOpen} onCancel={() => {}}>
	<Modal.Title>Insufficient Funds</Modal.Title>
</Modal.Root>

<!-- DECLARED AFTER the modal that opens it, which is the whole of what the app
     relied on to put it on top. -->
<Modal.Root layer={raisedLayer} openWhen={raisedOpen} onCancel={() => {}}>
	<Modal.Title>Top up the in-app balance</Modal.Title>
</Modal.Root>
