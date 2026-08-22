<script lang="ts">
	import {getAppContext, params} from '$lib';
	import ConnectionFlow from '$lib/core/connection/ConnectionFlow.svelte';
	import {DebugOperations} from '$lib/ui/debug';
	import {PendingOperationModal} from '$lib/ui/pending-operation';
	import TxObserverDebugOverlay from '$lib/debug/TxObserverDebugOverlay.svelte';

	import InsufficientFundsModal from '$lib/core/transaction/InsufficientFundsModal.svelte';
	import {TopUpModal} from '$lib/ui/credits/index.js';
	import ConfirmationModal from '$lib/core/ui/confirm/ConfirmationModal.svelte';
	import AccountCannotSendModal from '$lib/core/transaction/AccountCannotSendModal.svelte';
	import ErrorDetailsModal from '$lib/core/transaction/ErrorDetailsModal.svelte';
	import InFlightRequestsModal from '$lib/core/transaction/InFlightRequestsModal.svelte';

	const {connection, payment, inFlight} = getAppContext();
</script>

{#if params.transactions}
	<DebugOperations />
{/if}

{#if params['tx-observer']}
	<TxObserverDebugOverlay />
{/if}

<PendingOperationModal />

<InsufficientFundsModal />
<!-- After the funds modal, because it is opened FROM it when the signer is the
     account that cannot pay, and both are then on screen at once. -->
<TopUpModal />
<!-- After the top-up modal: it asks ABOUT that flow (carry on with what was
     interrupted, or really give up on a request the wallet may still act on),
     so it has to be able to sit on top of it. Belongs to no feature. -->
<ConfirmationModal />
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

     So the connection flows come last: a connection flow is always a sub-step of
     something else, and it has to be able to sit on top of whatever asked for
     it. This is not hypothetical here: declared before the modals, the wallet
     picker raised by a payment opened UNDERNEATH the top-up modal, and the click
     simply appeared to hang. -->
<!-- THIS IS THE FLOW THAT GETS THE LEDGER, and it is the only one.

     `$inFlight.dispatching` is app-wide and a flow is per connection, so a flow
     given the ledger reports the wallet as busy whenever ANY connection's is.
     This app is the variant that proved it: with both flows holding it, sending
     from the account put two identical "confirm the request in your wallet"
     modals on screen, one of them belonging to a payment connection that had
     never been asked for anything, and its escape hatch would have released the
     account connection's caller. See
     work/notes/findings/one-ledger-two-connections-two-wallet-modals.md.

     This is the connection the app dispatches through: context/index guards its
     client, and the local signer's. -->
<ConnectionFlow {connection} name="connection" {inFlight} />
<!-- The PAYMENT connection needs its own flow, or any step that requires the
     user (choosing between two installed wallets, approving a connection)
     happens with nothing on screen: the click just hangs. It is a separate
     connection, so one flow cannot serve both. Renders nothing until that
     connection actually starts connecting, which only a payment triggers.

     Its own `name`, so its escape hatch is a DIFFERENT overlay: the label is the
     identity in the registry, and sharing one would mean opening the hatch here
     also opened it over there. No ledger, so it speaks only for itself. -->
<ConnectionFlow connection={payment.connection} name="payment" />
