<script lang="ts">
	import {afterNavigate} from '$app/navigation';
	import {onDestroy} from 'svelte';
	import {page} from '$app/state';
	import {getAppContext} from '$lib';
	import {provideNavigation} from '$lib/core/capabilities';
	import {createKitNavigationDriver} from './navigation-driver';

	// Wiring only: attaches the SvelteKit driver to the navigation service the
	// context holds, and keeps it fed. Renders nothing.
	const {navigation} = getAppContext();

	provideNavigation(navigation);

	const driver = createKitNavigationDriver();

	// ATTACHED AFTER HYDRATION, not during it.
	//
	// Attaching reports the current location at once, which for a URL that
	// addresses a content overlay opens that overlay immediately. Do that while
	// the page is still hydrating and the dialog never mounts: the overlay's state
	// says open, nothing renders, and it stays that way until something toggles it
	// again. Landing directly on a link to an operation was exactly that case.
	//
	// `afterNavigate` fires for the initial load too (type 'enter'), after
	// hydration, which is the earliest moment it is safe to say where we are.
	let detach: (() => void) | undefined;
	afterNavigate(() => {
		if (detach) return;
		detach = navigation.attach(driver);
	});
	onDestroy(() => detach?.());

	// ONE location stream. `page` covers SvelteKit's navigations and its
	// shallow-routing state; the driver's own listeners cover the rest. Both ends
	// funnel into the same `notify`, so consumers never learn which world a
	// change came from.
	$effect(() => {
		void page.url;
		void page.state;
		driver.notify();
	});
</script>
