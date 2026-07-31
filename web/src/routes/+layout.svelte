<script lang="ts">
	import '../app.css';

	import {serviceWorker, notifications, params, route} from '$lib';
	import {provideRoute, provideENS} from '$lib/core/capabilities';
	import NotificationOverlay from '$lib/core/notifications/NotificationOverlay.svelte';
	import Notifications from '$lib/core/notifications/Notifications.svelte';
	import VersionAndInstallNotfications from '$lib/core/service-worker/VersionAndInstallNotfications.svelte';
	import NavigationProgress from '$lib/components/NavigationProgress.svelte';

	import {createContext} from '$lib/context/index.js';
	import AsyncContext from '$lib/context/AsyncContext.svelte';
	import Navbar from '$lib/ui/navbar/navbar.svelte';
	import RpcHealthBanner from '$lib/ui/rpc-health/RpcHealthBanner.svelte';
	import NonceCacheBanner from '$lib/ui/nonce-cache/NonceCacheBanner.svelte';
	import OfflineBanner from '$lib/ui/offline/OfflineBanner.svelte';
	import {createENSService} from '$lib/core/ens';
	import {Toaster} from '$lib/shadcn/ui/sonner';
	import AcrossPages from '$lib/context/AcrossPages.svelte';
	import {page} from '$app/state';

	let {children} = $props();

	// Provide ambient capabilities to core UI components.
	provideRoute(route);
	provideENS(createENSService());

	// The RPC-health / no-RPC banner is relevant on pages that read onchain data.
	// The home page does not, so it is excluded (blacklist). `page.route.id` is
	// base-path independent (works under IPFS/relative paths).
	let showRpcBanner = $derived(page.route.id !== '/');
</script>

<NavigationProgress />

<AsyncContext getContext={createContext}>
	<Navbar repoURL="https://github.com/wighawag/template-onchain-app" />
	<OfflineBanner />
	<NonceCacheBanner />
	{#if showRpcBanner}
		<RpcHealthBanner />
	{/if}

	{@render children()}

	<AcrossPages />
</AsyncContext>

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

<div id="--layer-drawer"></div>
<div id="--layer-modals"></div>
