<script lang="ts">
	import type {Snippet} from 'svelte';

	interface Props {
		class?: string;
		children: Snippet;
	}

	const {class: className = '', children}: Props = $props();
</script>

<!-- Global notification live region, render this permanently at the end of the
     document. No z-index of its own: the app puts this inside an overlay layer
     (`data-layer` in +layout.svelte, scale in app.css) and the layer decides what
     this sits above. A number here would be either redundant, because a layer is
     a stacking context, or a lie about how ordering is decided. -->
<div
	aria-live="assertive"
	class="pointer-events-none fixed inset-0 flex items-end px-4 py-6 sm:items-start sm:p-6 {className}"
>
	<div class="flex w-full flex-col items-center space-y-4 sm:items-end">
		{@render children?.()}
	</div>
</div>
