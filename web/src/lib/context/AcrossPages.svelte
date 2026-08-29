<script lang="ts">
	import {getAppContext, params} from '$lib';
	import ConnectionFlow from '$lib/core/connection/ConnectionFlow.svelte';
	import {DebugOperations} from '$lib/ui/debug';
	import {PendingOperationModal} from '$lib/ui/pending-operation';
	import TxObserverDebugOverlay from '$lib/debug/TxObserverDebugOverlay.svelte';

	import InsufficientFundsModal from '$lib/core/transaction/InsufficientFundsModal.svelte';
	import AccountCannotSendModal from '$lib/core/transaction/AccountCannotSendModal.svelte';
	import ErrorDetailsModal from '$lib/core/transaction/ErrorDetailsModal.svelte';
	import InFlightRequestsModal from '$lib/core/transaction/InFlightRequestsModal.svelte';

	const {connection, inFlight} = getAppContext();
</script>

{#if params.transactions}
	<DebugOperations />
{/if}

{#if params['tx-observer']}
	<TxObserverDebugOverlay />
{/if}

<PendingOperationModal />

<InsufficientFundsModal />
<AccountCannotSendModal />
<ErrorDetailsModal />
<!-- Below the connection flow, deliberately (see the note under this block on
     why the order here IS the stacking order). It reports on requests that are
     OVER, so if the flow ever raises something at the same moment, the live
     question belongs on top of the post-mortem. -->
<InFlightRequestsModal />

<!-- ORDER MATTERS when two of these are open at once.

     Every modal below is a SYSTEM overlay (`<Modal.Root layer="system">`), so
     they all sit in #--layer-system, one rank above the ordinary modal layer.
     That is what keeps them above a PAGE's own dialogs, and it has to be a layer
     rather than an order: a page remounts on every navigation and takes a fresh
     slot at the end of its layer, while this file keeps the slot it took when
     the app started, so the two used to stack differently depending on how the
     user arrived. See test/lib/core/ui/modal/modal-remount.svelte.test.ts.

     WITHIN that layer the layer decides nothing between them: they share one
     z-index, so THE ORDER THESE COMPONENTS ARE WRITTEN IN IS THE STACKING ORDER,
     and moving a line changes what covers what. Not the order they open in,
     which buys nothing; see the layer block in app.css for why, and
     test/lib/core/ui/modal/modal-stacking.svelte.test.ts for the proof.

     THAT ORDER ONLY APPLIES TO MODALS THAT ARE ACTUALLY IN THIS LAYER, which is
     the half this note used to leave out. A component listed below that does not
     pass `layer="system"` is not ranked by its position here at all: it is in
     the layer below, under every modal in this block, and moving its line does
     nothing. That is not hypothetical - it happened to the top-up modal, which
     is opened from the funds modal and spent its life rendering behind it. So
     ADDING A COMPONENT HERE MEANS GIVING IT `layer="system"` IN ITS OWN FILE;
     the prop has no default precisely so that this cannot be forgotten, and
     test/lib/core/ui/modal/modal-layer-stacking.svelte.test.ts shows what it
     looks like when it is.

     So the connection flow comes last: it is always a sub-step of something
     else, and it has to be able to sit on top of whatever asked for it. Declared
     before the modals, a wallet picker raised from inside one of them opens
     UNDERNEATH it, and the click simply appears to hang. -->
<!-- BOTH PROPS PASSED EXPLICITLY, though this app has one connection and both
     have defaults that would do.

     The ledger is app-wide and a flow is per connection, so a flow given the
     ledger claims the wallet is busy whenever ANY connection's is. Here that is
     the same thing. In a variant with a second connection it is not, and handing
     it to both put two identical "confirm the request in your wallet" modals on
     screen and let an idle connection's escape hatch release the other one's
     caller. Saying it out loud here is what makes the second flow a variant adds
     an obvious decision rather than an inherited accident. Same for `name`, which
     is the identity of this flow's escape-hatch overlay in the registry. -->
<ConnectionFlow {connection} name="connection" {inFlight} />
