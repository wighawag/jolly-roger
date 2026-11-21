<script lang="ts">
	import Notifications from '$lib/core/notifications/Notifications.svelte';
	import VersionAndInstallNotfications from '$lib/core/service-worker/VersionAndInstallNotfications.svelte';
	import NavigationProgress from '$lib/components/NavigationProgress.svelte';
	import {notifications, serviceWorker} from '$lib';
	import {LAYERS} from '$lib/core/ui/layers';
	import {navigating} from '$app/state';
	import {ModeWatcher} from 'mode-watcher';
	import '../app.css';
	let {children} = $props();
</script>

<!--
	The mode lives on <html>, where app.html already paints the page black.
	Without a watcher nothing sets it, so the shadcn tokens stay light (a
	white body on a black page), dialogs and toasts portalled to <body> come
	out white, and the sonner wrapper's `mode.current` still writes the
	SYSTEM preference into `color-scheme`, which gives a light phone light
	native scrollbars over a dark page. Dark by default, to match app.html; a
	descendant offering a light theme passes another `defaultMode`.
-->
<ModeWatcher defaultMode="dark" />

{@render children()}

<!--
	OVERLAY LAYERS.

	Every floating surface goes in one of these, and the ORDER IS DECIDED BY THE
	NUMBERS IN app.css (`--z-layer-*`), not by the order written here: each layer
	is a stacking context, so a surface's own z-index (shadcn's `z-50`) only
	ranks it against its layer-mates.

	The containers are rendered from `core/ui/layers.ts`, the same list that tells
	components which layer to target, so a layer cannot exist as a portal target
	with no container to land in (or the reverse). Four of them stay empty here
	for exactly that reason: they are PORTAL TARGETS, addressed by id from the
	dialog, drawer, popover and select contents (`lib/shadcn/ui/*/*-content.svelte`).
	A component that forgets to name its target does not land here, and then its
	paint order is an accident of where it sits in the tree.

	The rest hold the app's own surfaces, supplied below as snippets keyed by layer
	name. Written as snippets rather than as hand-placed divs so that the list
	stays the only place a layer is declared: a surface whose layer was deleted
	simply never renders, instead of quietly painting in the root stacking context
	above everything.
-->
{#snippet noticeLayer()}
	<VersionAndInstallNotfications {serviceWorker} />
{/snippet}

{#snippet toastLayer()}
	<Notifications {notifications} />
{/snippet}

{#snippet progressLayer()}
	<NavigationProgress isNavigating={() => !!navigating.to} />
{/snippet}

{#each LAYERS as layer (layer.id)}
	<div id={layer.id} data-layer={layer.name}>
		{#if layer.name === 'notice'}{@render noticeLayer()}{:else if layer.name === 'toast'}{@render toastLayer()}{:else if layer.name === 'progress'}{@render progressLayer()}{/if}
	</div>
{/each}
