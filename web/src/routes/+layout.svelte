<script lang="ts">
	import '../app.css';

	import {version} from '$app/environment';
	import {serviceWorker, notifications, params, route} from '$lib';
	import {
		provideRoute,
		provideENS,
		provideDocumentLocation,
	} from '$lib/core/capabilities';
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
	import SendingBanner from '$lib/ui/in-flight/SendingBanner.svelte';
	import {createENSService} from '$lib/core/ens';
	import {PUBLIC_ENS_NODE_URL} from '$env/static/public';
	import {Toaster} from '$lib/shadcn/ui/sonner';
	import AcrossPages from '$lib/context/AcrossPages.svelte';
	import KitNavigation from '$lib/kit/KitNavigation.svelte';
	import {navigating, page} from '$app/state';
	// Identity, from the one file that holds it. Deliberately NOT written as
	// literals here: this layout is the most-edited file in the template, so a
	// constant parked in it costs a merge conflict to every fork that changes it
	// (the `website` branch paid four for this one line). Empty means no link.
	import {repoURL, communityURL} from '../web-config.json';

	let {children} = $props();

	// Built once, synchronously, on the server as well as in the browser: every
	// service idles when browser APIs are absent, so the page (and its metadata)
	// prerenders instead of waiting behind a splash. Readiness arrives through
	// the stores. See ADR-0002 (`work` branch).
	const context = createContext();

	// Set when the app cannot run at all. Env-derived reasons are known at
	// construction (so the error also prerenders); the `?burner=true` one is
	// raised from start(), which swaps the app out for the error screen.
	const {fatal} = context.context;

	// Provide ambient capabilities to core UI components.
	provideRoute(route);
	// Where the document is, for the parts that must know during SSR (page
	// metadata). Getters, so components reading them track `page` as if they had
	// read it themselves, without importing the framework.
	provideDocumentLocation({
		pathname: () => page.url.pathname,
		version: () => version,
	});
	// ENS is optional: provide it only when an ENS RPC is configured. An empty
	// PUBLIC_ENS_NODE_URL disables ENS entirely (useENS() then returns undefined
	// and all ENS-aware components stay inert).
	if (PUBLIC_ENS_NODE_URL) provideENS(createENSService());

	// The RPC-health / no-RPC banner is relevant on pages that read onchain data.
	// The home page does not, so it is excluded (blacklist). `page.route.id` is
	// base-path independent (works under IPFS/relative paths).
	let showRpcBanner = $derived(page.route.id !== '/');
</script>

{#if $fatal}
	<InitError message={$fatal} />
{:else}
	<Context {context}>
		<!-- Wires SvelteKit to the navigation service the context holds, and
		     provides it as a capability. First, so anything below can rely on the
		     app knowing where it is. Renders nothing. -->
		<KitNavigation />
		<!-- The framework's answers, handed to components that must not ask for
		     themselves. Getters, so reading them inside those components tracks
		     `page`/`navigating` as if they had. See src/lib/kit/README.md. -->
		<Navbar {repoURL} {communityURL} currentPath={() => page.url.pathname} />
		<SendingBanner />
		<OfflineBanner />
		<NonceCacheBanner />
		{#if showRpcBanner}
			<RpcHealthBanner />
		{/if}

		{@render children()}

		<AcrossPages />
	</Context>
{/if}

<!--
	OVERLAY LAYERS.

	Every floating surface goes in one of these, and the ORDER IS DECIDED BY THE
	NUMBERS IN app.css (`--z-layer-*`), not by the order written here: each layer
	is a stacking context, so a surface's own z-index (shadcn's `z-50`, sonner's
	`999999999`) only ranks it against its layer-mates. They are still written in
	that same order, so reading this block tells you the truth.

	Two of them are empty: they are PORTAL TARGETS, addressed by id from
	`core/ui/modal/modal.svelte` and the navbar drawer. A component that forgets to
	name its target does not land here, and then its paint order is an accident of
	where it sits in the tree, which is exactly how the drawer once covered every
	modal.
-->
<div data-layer="drawer" id="--layer-drawer"></div>

<div data-layer="notice">
	<VersionAndInstallNotfications
		{serviceWorker}
		classes={{
			root: 'bg-background bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,var(--color-muted)_10px,var(--color-muted)_20px)]',
		}}
	/>
</div>

<div data-layer="toast">
	<Toaster position="bottom-right" richColors closeButton />
	<NotificationOverlay>
		<Notifications {notifications} />
	</NotificationOverlay>
</div>

<div data-layer="modal" id="--layer-modals"></div>

<div data-layer="progress">
	<NavigationProgress isNavigating={() => !!navigating.to} />
</div>
