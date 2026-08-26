<script lang="ts">
	import '../app.css';

	import {version} from '$app/environment';
	import {
		serviceWorker,
		notifications,
		params,
		route,
		sendingIndicator,
	} from '$lib';
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
	import SendingIndicator from '$lib/ui/in-flight/SendingIndicator.svelte';
	import {sendingIndicatorSlot} from '$lib/ui/in-flight/sending';
	import {createENSService} from '$lib/core/ens';
	import {PUBLIC_ENS_NODE_URL} from '$env/static/public';
	import {Toaster} from '$lib/shadcn/ui/sonner';
	import AcrossPages from '$lib/context/AcrossPages.svelte';
	import {LAYERS} from '$lib/core/ui/layers';
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
		<!-- THE HEIGHT SHELL, and the one place that decides how tall the app is.

		     A viewport-tall column: chrome (the navbar and the in-flow bars) as
		     fixed-size children, and the page in a `flex-1 min-h-0` region, which
		     makes that region EXACTLY what the chrome leaves and never more. A banner
		     appearing therefore SHRINKS the page instead of pushing it down: nothing
		     goes under the fold, and nothing re-lays-out when the banner leaves.

		     WHAT IT BUYS A DESCENDANT: inside the region, `h-full` means "the
		     viewport minus whatever chrome is up right now", so an app with a canvas,
		     a map or a board can occupy the screen exactly, with no scrollbar,
		     WITHOUT knowing which bars exist or how tall they are. Without a shell
		     every such app reaches for `h-screen` somewhere below instead, and
		     `h-screen` plus a bar is a page taller than the screen by the height of
		     the bar. That trap was armed in the template, so it was armed once for
		     every descendant, which is why it is disarmed here rather than in the app
		     that happened to trip it.

		     WHY THE BARS STAY IN FLOW instead of floating clear of the problem: they
		     report DURABLE conditions (offline, no RPC, a stale nonce cache) that
		     last minutes, and a permanent overlay covering the app's own UI is worse
		     than a bar that honestly takes its space. `ui/in-flight/sending.ts` draws
		     the same line from the other side - transient action feedback floats,
		     durable conditions take space - and the shell is what makes taking space
		     affordable.

		     `[&>*]:shrink-0` so that chrome is chrome: on a short viewport the bars
		     keep their height and the page absorbs the loss, rather than a squashed
		     navbar. It reaches the content region too, harmlessly: that one grows
		     from a basis of 0, so there is never anything to shrink.

		     THE CONCESSION, since this is a height contract for every descendant at
		     once. The DOCUMENT is still the scroller, which is what keeps ordinary
		     pages ordinary: a page longer than the region overflows it and the window
		     scrolls, with native scroll restoration on back, the mobile URL bar
		     retracting, pull-to-refresh, and `scrollbar-gutter` (app.css) all
		     unchanged. The price is that sticky chrome can only stay pinned while its
		     containing block - this shell - is on screen, so on a long page the bars
		     scroll away after one screenful instead of staying up forever. An app
		     that would rather keep them pinned can put `overflow-y-auto` on the
		     content region and have an app-shell scroller instead, and then owes that
		     whole list back: SvelteKit saves and restores WINDOW scroll, so a region
		     that scrolls itself has to manage its own. -->
		<div class="flex h-dvh flex-col [&>*]:shrink-0">
			<!-- The framework's answers, handed to components that must not ask for
			     themselves. Getters, so reading them inside those components tracks
			     `page`/`navigating` as if they had. See src/lib/kit/README.md. -->
			<Navbar {repoURL} {communityURL} currentPath={() => page.url.pathname} />
			<!-- Only the in-flow placement lands here, beside the other bars. The
		     default one floats and is rendered in an overlay layer below, because it
		     is transient action feedback rather than a condition the page should
		     make room for. `$lib` decides which, and `sendingIndicatorSlot` is where
		     that choice becomes a mount point, so a placement with nowhere to go is
		     a type error rather than a knob that silently does nothing. -->
			{#if sendingIndicatorSlot(sendingIndicator) === 'flow'}
				<SendingIndicator
					inFlight={context.context.inFlight}
					placement="banner"
				/>
			{/if}
			<OfflineBanner />
			<NonceCacheBanner />
			{#if showRpcBanner}
				<RpcHealthBanner />
			{/if}

			<!-- The content region. `min-h-0` is the load-bearing half: without it a
			     flex item refuses to be shorter than its content, the region grows past
			     the fold, and the shell is a decoration. `data-app-content` is the
			     handle the shell's e2e test measures, and a stable name for a
			     descendant that has to reach the region from outside the tree. -->
			<div data-app-content class="min-h-0 flex-1">
				{@render children()}
			</div>
		</div>

		<!-- Outside the shell: everything it renders is a portal or a fixed-position
		     surface, so it has no business being a row in the column. -->
		<AcrossPages />
	</Context>
{/if}

<!--
	OVERLAY LAYERS.

	Every floating surface goes in one of these, and the ORDER IS DECIDED BY THE
	NUMBERS IN app.css (`--z-layer-*`), not by the order written here: each layer
	is a stacking context, so a surface's own z-index (shadcn's `z-50`, sonner's
	`999999999`) only ranks it against its layer-mates.

	The containers are rendered from `core/ui/layers.ts`, the same list that tells
	components which layer to target, so a layer cannot exist as a portal target
	with no container to land in (or the reverse). Four of them stay empty for
	exactly that reason: they are PORTAL TARGETS, addressed by id from
	`core/ui/modal/modal.svelte` (which addresses TWO of them, the modal layer and
	the system layer above it), the navbar drawer and the popover/select contents.
	A component that forgets to name its target does not land here, and then its
	paint order is an accident of where it sits in the tree, which is how the
	drawer once covered every modal.

	The rest hold app-owned surfaces, supplied below as snippets keyed by layer
	name. Written as snippets rather than as hand-placed divs so that the list
	stays the only place a layer is declared: a surface whose layer was deleted
	simply never renders, instead of quietly painting in the root stacking context
	above everything.
-->
{#snippet noticeLayer()}
	<VersionAndInstallNotfications
		{serviceWorker}
		classes={{
			root: 'bg-background bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,var(--color-muted)_10px,var(--color-muted)_20px)]',
		}}
	/>
{/snippet}

{#snippet toastLayer()}
	<Toaster position="bottom-right" richColors closeButton />
	<NotificationOverlay>
		<Notifications {notifications} />
	</NotificationOverlay>
{/snippet}

{#snippet progressLayer()}
	<NavigationProgress isNavigating={() => !!navigating.to} />
	<!-- HERE RATHER THAN IN THE TOAST LAYER, which is where it started. A system
	     modal (the wallet-action prompt) sits above the toast layer and dims what
	     is under its backdrop, so the one sentence explaining what leaving the
	     page would cost was greyed out exactly while the user was being held by a
	     modal, which is when they are most likely to give up and reload. Both are
	     views of the SAME fact, a dispatch being awaited, so neither can be said
	     to interrupt the other. See the layer's `holds` in core/ui/layers.ts.

	     The ledger is passed in because this is OUTSIDE `<Context>`: a layer
	     container is a sibling of it, so there is no app context to ask here. -->
	{#if sendingIndicatorSlot(sendingIndicator) === 'overlay'}
		<SendingIndicator
			inFlight={context.context.inFlight}
			placement="floating"
		/>
	{/if}
{/snippet}

{#each LAYERS as layer (layer.id)}
	<div id={layer.id} data-layer={layer.name}>
		{#if layer.name === 'notice'}{@render noticeLayer()}{:else if layer.name === 'toast'}{@render toastLayer()}{:else if layer.name === 'progress'}{@render progressLayer()}{/if}
	</div>
{/each}
