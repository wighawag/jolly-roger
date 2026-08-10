<script lang="ts">
	import '../app.css';

	import {serviceWorker, notifications, params, route} from '$lib';
	import {provideRoute, provideENS} from '$lib/core/capabilities';
	import NotificationOverlay from '$lib/core/notifications/NotificationOverlay.svelte';
	import Notifications from '$lib/core/notifications/Notifications.svelte';
	import VersionAndInstallNotfications from '$lib/core/service-worker/VersionAndInstallNotfications.svelte';
	import NavigationProgress from '$lib/components/NavigationProgress.svelte';

	import {createContext} from '$lib/context/index.js';
	import Context from '$lib/context/Context.svelte';
	import InitError from '$lib/context/InitError.svelte';
	import Navbar from '$lib/ui/navbar/navbar.svelte';
	import RpcHealthBanner from '$lib/ui/rpc-health/RpcHealthBanner.svelte';
	import NonceCacheBanner from '$lib/ui/nonce-cache/NonceCacheBanner.svelte';
	import OfflineBanner from '$lib/ui/offline/OfflineBanner.svelte';
	import {createENSService} from '$lib/core/ens';
	import {PUBLIC_ENS_NODE_URL} from '$env/static/public';
	import {Toaster} from '$lib/shadcn/ui/sonner';
	import AcrossPages from '$lib/context/AcrossPages.svelte';
	import {LAYERS} from '$lib/core/ui/layers';
	import {page} from '$app/state';

	let {children} = $props();

	// Built once, synchronously, on the server as well as in the browser: every
	// service idles when browser APIs are absent, so the page (and its metadata)
	// prerenders instead of waiting behind a splash. Readiness arrives through
	// the stores. See ADR-0002.
	const context = createContext();

	// Set when the app cannot run at all. Env-derived reasons are known at
	// construction (so the error also prerenders); the `?burner=true` one is
	// raised from start(), which swaps the app out for the error screen.
	const {fatal} = context.context;

	// Provide ambient capabilities to core UI components.
	provideRoute(route);
	// ENS is optional: provide it only when an ENS RPC is configured. An empty
	// PUBLIC_ENS_NODE_URL disables ENS entirely (useENS() then returns undefined
	// and all ENS-aware components stay inert).
	if (PUBLIC_ENS_NODE_URL) provideENS(createENSService());

	// The RPC-health / no-RPC banner is relevant on pages that read onchain data.
	// The home page does not, so it is excluded (blacklist). `page.route.id` is
	// base-path independent (works under IPFS/relative paths).
	let showRpcBanner = $derived(page.route.id !== '/');
</script>

<NavigationProgress />

{#if $fatal}
	<InitError message={$fatal} />
{:else}
	<Context {context}>
		<Navbar />
		<OfflineBanner />
		<NonceCacheBanner />
		{#if showRpcBanner}
			<RpcHealthBanner />
		{/if}

		{@render children()}

		<AcrossPages />
	</Context>
{/if}

<Toaster position="bottom-right" richColors closeButton />

<VersionAndInstallNotfications
	{serviceWorker}
	classes={{
		root: 'bg-background bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,var(--color-muted)_10px,var(--color-muted)_20px)]',
	}}
/>

<NotificationOverlay>
	<Notifications {notifications} />
</NotificationOverlay>

<!-- The containers every portalled overlay is sent to. Rendered from the one
     list that also tells components which layer to target, so a new layer
     cannot exist as a target with no container to land in (or the reverse).

     `position: relative` + `z-index` makes each one a stacking context, which
     is what confines the `z-50` that shadcn puts on every overlay to sorting
     WITHIN its layer. The divs are empty and unsized, so they cost no layout.
     See lib/core/ui/layers.ts for the order and the reasoning. -->
{#each LAYERS as layer (layer.id)}
	<div id={layer.id} style="position: relative; z-index: {layer.z};"></div>
{/each}
