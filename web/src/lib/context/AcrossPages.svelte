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

     They share one LAYER (#--layer-modals, see core/ui/modal/modal.svelte and
     the layer scale in app.css), so the layer decides nothing between them:
     within it they share one z-index, so THE ORDER THESE COMPONENTS ARE WRITTEN
     IN IS THE STACKING ORDER, and moving a line changes what covers what. Not
     the order they open in, which buys nothing; see the layer block in app.css
     for why, and test/lib/core/ui/modal/modal-stacking.svelte.test.ts for the
     proof.

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
