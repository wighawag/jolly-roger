<script lang="ts">
	// THE REAL SCALE, not a copy of it: the z-index assertions below read what
	// app.css actually says, so renumbering the layers there is caught here.
	import '../../../../../src/app.css';
	import * as Modal from '$lib/core/ui/modal/index.js';

	/**
	 * The app's real shape: a LAYOUT that stays mounted, and a PAGE the router
	 * swaps out on every navigation.
	 *
	 * `+layout.svelte` renders `{@render children()}` and then `<AcrossPages />`,
	 * so on a cold load the page's modals mount FIRST and the system modals
	 * second. Navigate once and the layout does not remount while the page does,
	 * which reverses them. That is what the layer split exists to survive, so the
	 * harness reproduces it rather than describing it.
	 */
	let {pageMounted = true, pageOpen = false, systemOpen = false} = $props();
</script>

<!-- Both layers, as +layout.svelte supplies them, with the same relative order
     and the same custom properties. -->
<div data-layer="modal" id="--layer-modals"></div>
<div data-layer="system" id="--layer-system"></div>

<!-- The page: mounted and unmounted by the router. -->
{#if pageMounted}
	<Modal.Root openWhen={pageOpen} onCancel={() => {}}>
		<Modal.Title>Page modal</Modal.Title>
	</Modal.Root>
{/if}

<!-- AcrossPages: mounted once, for the life of the app. -->
<Modal.Root layer="system" openWhen={systemOpen} onCancel={() => {}}>
	<Modal.Title>Wallet Action Required</Modal.Title>
</Modal.Root>
