<script lang="ts">
	import {onMount} from 'svelte';

	interface Props {
		/**
		 * Whether a navigation is in flight.
		 *
		 * A getter rather than SvelteKit's `navigating`, so this component knows
		 * nothing about the framework that produced it (src/lib/kit/README.md).
		 * Reading it inside `$derived` below tracks it exactly as the import did.
		 * The app root passes `() => !!navigating.to`.
		 */
		navigatingTo: () => boolean;
	}

	const {navigatingTo}: Props = $props();

	// Owns every navigation indicator in the app:
	//   - in-app (SPA) navigation .... bar + spinner, while still on the old URL
	//   - external same-tab links .... indeterminate bar + spinner, until unload
	//   - the pre-JS bar in app.html . retired on mount (see onMount below)
	// Nothing else in the app needs to know about navigation feedback.

	const SHOW_DELAY = 150; // ms in flight before the indicator appears
	const FINISH_MS = 320; // ms for the complete + fade-out animation
	const FADE_MS = 400; // ms safety for the pre-JS bar fade-out
	// Cross-origin navigations give us no completion event (the document
	// unloads instead). If the click somehow does not unload the page, this
	// bounds how long the indicator can linger.
	const EXTERNAL_SAFETY_MS = 10_000;

	type Phase = 'idle' | 'loading' | 'finishing';
	let phase = $state<Phase>('idle');
	// The current run has no completion event to wait for (external link).
	let external = $state(false);

	let showTimer: ReturnType<typeof setTimeout> | undefined;
	let finishTimer: ReturnType<typeof setTimeout> | undefined;
	let safetyTimer: ReturnType<typeof setTimeout> | undefined;

	// The caller decides what counts as in-flight. With SvelteKit's `navigating`
	// that is `!!navigating.to`: it is never literally null (when idle it is an
	// object whose `to`/`from`/`type` are all null), so an in-flight navigation is
	// signalled by `to` being set. Leaving the app has `to === null`, which
	// correctly excludes it (the browser shows its own indicator).
	const isNavigating = $derived(navigatingTo());

	// Only depends on `isNavigating`. The cleanup reads `phase`, but cleanup
	// functions are not tracked, so `phase` writes never re-run this.
	$effect(() => {
		const loading = isNavigating;
		if (loading) {
			clearTimeout(safetyTimer); // an in-app nav supersedes an external one
			external = false;
			showTimer = setTimeout(() => (phase = 'loading'), SHOW_DELAY);
		}
		return () => {
			clearTimeout(showTimer);
			if (loading && phase === 'loading') {
				// Completed while visible: run to 100% and fade out.
				phase = 'finishing';
				finishTimer = setTimeout(() => (phase = 'idle'), FINISH_MS);
			}
		};
	});

	/** Will this click navigate THIS tab to another origin? */
	function isExternalSameTabLink(a: HTMLAnchorElement, e: MouseEvent) {
		if (e.defaultPrevented) return false;
		// plain left-click only: modifiers open a new tab, so we stay put
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
			return false;
		}
		const href = a.getAttribute('href');
		if (!href) return false;
		if (/^(mailto:|tel:|sms:|javascript:|data:|#)/i.test(href)) return false;
		if (a.hasAttribute('download')) return false;
		const target = a.getAttribute('target');
		if (target && target.toLowerCase() !== '_self') return false;
		try {
			// same-origin links are handled by SvelteKit, and show up via
			// `navigating` above rather than here
			return new URL(href, location.href).origin !== location.origin;
		} catch {
			return false;
		}
	}

	function onclick(event: MouseEvent) {
		const anchor = event
			.composedPath()
			.find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);
		if (!anchor || !isExternalSameTabLink(anchor, event)) return;

		// The browser will unload this document; CSS animations keep running
		// during teardown, so the indicator stays painted until the new page
		// paints over it.
		clearTimeout(showTimer);
		clearTimeout(finishTimer);
		external = true;
		phase = 'loading';
		safetyTimer = setTimeout(() => {
			phase = 'idle';
			external = false;
		}, EXTERNAL_SAFETY_MS);
	}

	onMount(() => {
		// Retire the pre-JS bar from app.html: from now on this component is
		// the only thing that shows navigation feedback.
		const preJsBar = document.getElementById('app-loader');
		if (preJsBar) {
			preJsBar.classList.add('hide');
			const remove = () => preJsBar.remove();
			preJsBar.addEventListener('transitionend', remove, {once: true});
			setTimeout(remove, FADE_MS); // in case transitionend never fires
		}
		return () => {
			clearTimeout(showTimer);
			clearTimeout(finishTimer);
			clearTimeout(safetyTimer);
		};
	});
</script>

<svelte:window {onclick} />

{#if phase !== 'idle'}
	{@const finishing = phase === 'finishing'}
	<div
		class="bar"
		class:finishing
		class:indeterminate={external}
		aria-hidden="true"
	>
		<div class="bar-fill"></div>
	</div>
	<div class="spinner" class:finishing aria-hidden="true">
		<svg viewBox="0 0 24 24">
			<circle class="track" cx="12" cy="12" r="9" />
			<circle class="arc" cx="12" cy="12" r="9" />
		</svg>
	</div>
{/if}

<style>
	/* --nav-accent / --nav-bar-height come from the inline :root block in
	   app.html, so the pre-JS bar and this component always match. Fallbacks
	   keep this component standalone if that block ever goes away. */
	.bar {
		position: fixed;
		inset: 0 0 auto 0;
		height: var(--nav-bar-height, 2px);
		z-index: 9999;
		pointer-events: none;
		background: rgb(var(--nav-accent, 148 163 184) / 0.12);
	}

	.bar-fill {
		height: 100%;
		background: rgb(var(--nav-accent, 148 163 184));
		box-shadow: 0 0 8px rgb(var(--nav-accent, 148 163 184) / 0.55);
		transform-origin: left;
		/* Creep toward, but never reach, 100% while still loading. */
		animation: grow 8s cubic-bezier(0.1, 0.55, 0.1, 1) forwards;
		transition:
			width 0.2s ease-out,
			opacity 0.3s ease-out;
	}

	.bar.finishing .bar-fill {
		animation: none;
		width: 100%;
		opacity: 0;
	}

	/* External navigations expose no progress, so sweep instead of creeping. */
	.bar.indeterminate .bar-fill {
		width: 40%;
		animation: shuttle 1.1s ease-in-out infinite;
	}

	.spinner {
		position: fixed;
		top: 14px;
		right: 16px;
		z-index: 9999;
		width: 22px;
		height: 22px;
		pointer-events: none;
		transition: opacity 0.3s ease-out;
	}

	.spinner.finishing {
		opacity: 0;
	}

	.spinner svg {
		width: 100%;
		height: 100%;
		animation: spin 0.7s linear infinite;
	}

	.spinner circle {
		fill: none;
		stroke-width: 3;
	}

	.spinner .track {
		stroke: rgb(var(--nav-accent, 148 163 184) / 0.18);
	}

	/* circumference = 2 * pi * 9 =~ 56.5, so 42/14 is about a 3/4 arc */
	.spinner .arc {
		stroke: rgb(var(--nav-accent, 148 163 184));
		stroke-linecap: round;
		stroke-dasharray: 42 14;
	}

	@keyframes grow {
		0% {
			width: 0%;
		}
		10% {
			width: 35%;
		}
		30% {
			width: 62%;
		}
		55% {
			width: 80%;
		}
		80% {
			width: 90%;
		}
		100% {
			width: 95%;
		}
	}

	@keyframes shuttle {
		0% {
			transform: translateX(-100%);
		}
		50% {
			transform: translateX(150%);
		}
		100% {
			transform: translateX(350%);
		}
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bar-fill,
		.bar.indeterminate .bar-fill {
			animation: none;
			width: 95%;
		}
		.bar.finishing .bar-fill {
			width: 100%;
		}
		.spinner svg {
			animation-duration: 1.6s;
		}
	}
</style>
