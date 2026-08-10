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

	const {connection, payment} = getAppContext();
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

<!-- ORDER MATTERS when two of these are open at once.

     They share one container (#--layer-modals, see core/ui/modal/modal.svelte)
     and one z-index, so the one appended LAST paints on top. A dialog is
     appended when it opens, but dialogs that open in the SAME synchronous block
     are appended in the order their components appear here - and that is the
     normal case, because an action typically sets its own state and calls
     ensureConnected() before it ever awaits.

     So the connection flows come last: a connection flow is always a sub-step of
     something else, and it has to be able to sit on top of whatever asked for
     it. This is not hypothetical here: declared before the modals, the wallet
     picker raised by a payment opened UNDERNEATH the top-up modal, and the click
     simply appeared to hang. -->
<ConnectionFlow {connection} />
<!-- The PAYMENT connection needs its own flow, or any step that requires the
     user (choosing between two installed wallets, approving a connection)
     happens with nothing on screen: the click just hangs. It is a separate
     connection, so one flow cannot serve both. Renders nothing until that
     connection actually starts connecting, which only a payment triggers. -->
<ConnectionFlow connection={payment.connection} />
