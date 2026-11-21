<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";
	import PopoverPortal from "./popover-portal.svelte";
	import { POPOVER_LAYER } from "$lib/core/ui/layers";
	import { cn, type WithoutChildrenOrChild } from "$lib/shadcn/utils.js";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		align = "center",
		portalProps,
		...restProps
	}: PopoverPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof PopoverPortal>>;
	} = $props();
</script>

<!-- KEEP THE `to` DEFAULT IF YOU REGENERATE THIS FILE from the shadcn CLI.
	 A popover is anchored to something in a lower layer (an address inside the
	 account panel, an avatar inside a modal), so it has to be able to escape
	 that layer's stacking context. Without this it would be clipped UNDER the
	 modal that contains its trigger. See lib/core/ui/layers.ts. -->
<PopoverPortal to={POPOVER_LAYER} {...portalProps}>
	<PopoverPrimitive.Content
		bind:ref
		data-slot="popover-content"
		{sideOffset}
		{align}
		class={cn(
			"bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 flex flex-col gap-2.5 rounded-lg p-2.5 text-sm shadow-md ring-1 duration-100 data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2 z-50 w-72 origin-(--transform-origin) outline-hidden",
			className
		)}
		{...restProps}
	/>
</PopoverPortal>
