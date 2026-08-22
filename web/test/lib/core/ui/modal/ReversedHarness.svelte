<script lang="ts">
	import * as Modal from '$lib/core/ui/modal/index.js';

	// Same two modals, DECLARED IN THE OPPOSITE ORDER.
	let {parentOpen = false, childOpen = false} = $props();
</script>

<div data-layer="modal" id="--layer-modals"></div>

<Modal.Root openWhen={childOpen} onCancel={() => {}}>
	<Modal.Title>Child prompt</Modal.Title>
</Modal.Root>

<Modal.Root openWhen={parentOpen} onCancel={() => {}}>
	<Modal.Title>Parent modal</Modal.Title>
</Modal.Root>
