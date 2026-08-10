<script lang="ts">
	import { Drawer as DrawerPrimitive } from "vaul-svelte";
	import DrawerPortal from "./drawer-portal.svelte";
	import { DRAWER_LAYER } from "$lib/core/ui/layers";
	import DrawerOverlay from "./drawer-overlay.svelte";
	import { cn } from "$lib/shadcn/utils.js";
	import type { ComponentProps } from "svelte";
	import type { WithoutChildrenOrChild } from "$lib/shadcn/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		children,
		...restProps
	}: DrawerPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DrawerPortal>>;
	} = $props();
</script>

<!-- KEEP THE `to` DEFAULT IF YOU REGENERATE THIS FILE from the shadcn CLI.
	 Content owns the portal, so this is the only place a drawer's layer can be
	 decided for every call site; a sibling `<Drawer.Portal to="..." />` has no
	 children and silently does nothing, which is exactly how the drawer ended up
	 in `body`, painting over the modals it opened itself. See
	 lib/core/ui/layers.ts. -->
<DrawerPortal to={DRAWER_LAYER} {...portalProps}>
	<DrawerOverlay />
	<DrawerPrimitive.Content
		bind:ref
		data-slot="drawer-content"
		class={cn(
			"group/drawer-content bg-background fixed z-50 flex h-auto flex-col",
			"data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh] data-[vaul-drawer-direction=top]:rounded-b-lg data-[vaul-drawer-direction=top]:border-b",
			"data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[80vh] data-[vaul-drawer-direction=bottom]:rounded-t-lg data-[vaul-drawer-direction=bottom]:border-t",
			"data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:end-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:border-s data-[vaul-drawer-direction=right]:sm:max-w-sm",
			"data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:start-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:border-e data-[vaul-drawer-direction=left]:sm:max-w-sm",
			className
		)}
		{...restProps}
	>
		<div
			class="bg-muted mx-auto mt-4 hidden h-2 w-[100px] shrink-0 rounded-full group-data-[vaul-drawer-direction=bottom]/drawer-content:block"
		></div>
		{@render children?.()}
	</DrawerPrimitive.Content>
</DrawerPortal>
