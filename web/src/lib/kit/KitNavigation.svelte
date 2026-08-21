<script lang="ts">
	import {afterNavigate} from '$app/navigation';
	import {onDestroy, onMount} from 'svelte';
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
	let destroyed = false;

	function attachOnce() {
		if (detach || destroyed) return;
		detach = navigation.attach(driver);
	}

	afterNavigate(attachOnce);

	// AND A FALLBACK, because `afterNavigate` not firing is silent and ruinous.
	//
	// Without a driver the service answers "I don't know" to everything and every
	// command is a no-op, BY DESIGN, so that it is constructible on the server
	// (ADR-0002). In the browser that same inertness means no URL updates, no
	// history entries, no back-closes-the-overlay, and no unload guard, while
	// prompt overlays still open and close perfectly well because the registry
	// owns their state. So the app looks fine and quietly is not, which is exactly
	// how this reached a user: `attached: false` with a transaction in flight and
	// an unload guard that could never fire.
	//
	// AFTER A PAINTED FRAME, not just after a macrotask. Attaching reports the
	// current location at once, and doing that mid-hydration is the original bug
	// this component's comment describes, so the fallback must not be able to win
	// a race against hydration and cause it. `setTimeout(0)` is USUALLY later than
	// `afterNavigate`, but nothing guarantees it: any hydration that yields to a
	// macrotask flips the order, and the fallback would then do the very thing the
	// comment above warns about, while printing a warning that reads as a false
	// alarm. A frame has definitely been rendered by the time rAF's callback runs,
	// so the dialog-mounting window this all exists to avoid is closed.
	//
	// In the normal case `afterNavigate` has already run long before, and all of
	// this is a no-op.
	onMount(() => {
		let frame: number | undefined;
		const timer = setTimeout(() => {
			frame = requestAnimationFrame(() => {
				if (detach || destroyed) return;
				if (import.meta.env.DEV) {
					console.warn(
						'[navigation] afterNavigate did not fire on mount, so the driver ' +
							'is being attached by the fallback. Navigation works, but this is ' +
							'worth understanding: see src/lib/kit/KitNavigation.svelte.',
					);
				}
				attachOnce();
			});
		}, 0);
		return () => {
			clearTimeout(timer);
			if (frame !== undefined) cancelAnimationFrame(frame);
		};
	});

	onDestroy(() => {
		destroyed = true;
		detach?.();
	});

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
