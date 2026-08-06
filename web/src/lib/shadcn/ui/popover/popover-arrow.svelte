<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";
	import { cn } from "$lib/shadcn/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: PopoverPrimitive.ArrowProps = $props();
</script>

<PopoverPrimitive.Arrow
	bind:ref
	class={cn(className)}
	{...restProps}
/>
