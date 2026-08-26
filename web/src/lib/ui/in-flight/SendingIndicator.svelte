<script lang="ts">
	import {fade} from 'svelte/transition';
	import type {Readable} from 'svelte/store';
	import SendIcon from '@lucide/svelte/icons/send';
	import type {InFlightState} from '$lib/core/transaction/in-flight-store';
	import {createSendingNotice, type SendingIndicatorPlacement} from './sending';

	// WHERE, not whether. The app decides in `$lib` (see
	// `SendingIndicatorPlacement`) and mounts this in the matching place:
	// `floating` goes in the toast layer, `banner` goes in the document flow at
	// the top of the layout. The prop only picks the dressing, so the two cannot
	// disagree about which surface this is.
	//
	// THE LEDGER IS A PROP, not `getAppContext()`, and that is the floating
	// placement's doing: the layer containers are rendered OUTSIDE `<Context>`
	// (they are siblings of it, at the end of the document), so a component in a
	// layer has no app context to ask and prerendering fails on `missing_context`
	// if it tries. The layout holds the context object itself and can hand the
	// ledger over, which works identically in both placements.
	const {
		inFlight,
		placement = 'floating',
	}: {
		inFlight: Readable<InFlightState>;
		// Derived from the app's own union rather than spelled out again, minus the
		// value that means "do not render me": a placement added there is then a
		// compile error here until this file has an answer for it.
		placement?: Exclude<SendingIndicatorPlacement, 'none'>;
	} = $props();

	// The rules are in sending.ts, per AGENTS.md: this file renders one of them
	// and owns nothing but the fade. `createSendingNotice` is the DELAYED rung, so
	// a dispatch that is answered quickly never paints text here at all; the
	// navbar's pulse is what covers that case.
	//
	// Read once, deliberately. The ledger is built with the app context and lives
	// as long as the app does, so there is no later value to miss; rebuilding the
	// derived chain whenever the prop is touched would reset both clocks and bring
	// back the flicker they exist to prevent.
	// svelte-ignore state_referenced_locally
	const sending = createSendingNotice(inFlight);
</script>

<!-- One wording for both placements. The sentence is the whole point of the
     surface (it explains the browser's "Leave site?" dialog), so it must not be
     able to drift between them. -->
{#snippet message()}
	{#if $sending.count > 1}
		Sending {$sending.count} transactions. Leaving the page now means waiting to find
		out whether they went through.
	{:else}
		Sending{$sending.description ? ` ${$sending.description}` : ''}. Leaving the
		page now means waiting to find out whether it went through.
	{/if}
{/snippet}

{#if $sending.sending}
	{#if placement === 'banner'}
		<div
			data-testid="sending-notice"
			class="flex w-full items-center gap-2 border-b border-amber-900 bg-amber-950 px-4 py-2"
			role="status"
			aria-live="polite"
		>
			<SendIcon class="h-4 w-4 shrink-0 animate-pulse text-amber-400" />
			<span class="text-sm text-amber-400">{@render message()}</span>
		</div>
	{:else}
		<!-- `pointer-events-none` throughout: nothing here is clickable, and a
		     surface that covers the page for a moment must not be able to swallow
		     a click aimed at what is underneath it. It clears the navbar by reading
		     the SAME `--navbar-height` the navbar sizes itself with (app.css), so a
		     taller navbar moves this instead of being overlapped by it. -->
		<div
			class="pointer-events-none fixed inset-x-0 top-[calc(var(--navbar-height)+0.5rem)] flex justify-center px-4"
			transition:fade={{duration: 150}}
		>
			<div
				data-testid="sending-notice"
				class="flex max-w-md items-center gap-2 rounded-full border border-amber-900 bg-amber-950/95 px-3 py-1.5 shadow-lg backdrop-blur-sm"
				role="status"
				aria-live="polite"
			>
				<SendIcon class="h-4 w-4 shrink-0 animate-pulse text-amber-400" />
				<span class="text-xs text-amber-400">{@render message()}</span>
			</div>
		</div>
	{/if}
{/if}
