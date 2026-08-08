<script lang="ts">
	import {getAppContext, params} from '$lib';
	import ConnectionFlow from '$lib/core/connection/ConnectionFlow.svelte';
	import {DebugOperations} from '$lib/ui/debug';
	import {PendingOperationModal} from '$lib/ui/pending-operation';
	import TxObserverDebugOverlay from '$lib/debug/TxObserverDebugOverlay.svelte';

	import InsufficientFundsModal from '$lib/core/transaction/InsufficientFundsModal.svelte';
	import {TopUpModal} from '$lib/ui/credits/index.js';
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
<AccountCannotSendModal />
<ErrorDetailsModal />

<!-- ORDER MATTERS, and it is the only thing that decides what is on top.

     Every modal here portals into document.body at z-50 (shadcn's Dialog.Content
     wraps itself in its own portal with no target), so among them the one
     appended LAST paints on top. Appending happens when a dialog opens, but
     dialogs that open in the SAME synchronous block are appended in the order
     their components appear here - and that is the normal case, because an
     action typically sets its own state and calls ensureConnected() before it
     ever awaits.

     So the connection flows come last: a connection flow is always a sub-step of
     something else (a payment started from the top-up modal, say), and it has to
     be able to sit on top of whatever asked for it. Declared earlier, the wallet
     picker opened UNDERNEATH the top-up modal and the click appeared to hang. -->
<ConnectionFlow {connection} />
<!-- The PAYMENT connection needs its own flow, or any step that requires the
     user (choosing between two installed wallets, approving a connection)
     happens with nothing on screen: the click just hangs. It is a separate
     connection, so one flow cannot serve both. Renders nothing until that
     connection actually starts connecting, which only a payment triggers. -->
<ConnectionFlow connection={payment.connection} />
