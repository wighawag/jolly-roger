<script lang="ts">
	// The in-flow placement of the sending indicator, as a zero-prop bar so it
	// can sit in the chrome list beside the other conditions.
	//
	// A WRAPPER RATHER THAN A DIRECT ENTRY, for two reasons that both come from
	// the floating placement rather than this one. `SendingIndicator` takes the
	// ledger as a PROP because the floating copy renders outside `<Context>` and
	// has no app context to ask; here we are inside it, so this asks. And the
	// placement decision belongs to `$lib` (see `SendingIndicatorPlacement`), so
	// the gate lives with the component that would otherwise render in the wrong
	// slot, not in the shell that would then have to know about it.
	import {getAppContext, sendingIndicator} from '$lib';
	import SendingIndicator from './SendingIndicator.svelte';
	import {sendingIndicatorSlot} from './sending';

	const {inFlight} = getAppContext();
</script>

{#if sendingIndicatorSlot(sendingIndicator) === 'flow'}
	<SendingIndicator {inFlight} placement="banner" />
{/if}
