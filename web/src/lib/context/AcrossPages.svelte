<script lang="ts">
	import {getAppContext, params} from '$lib';
	import ConnectionFlow from '$lib/core/connection/ConnectionFlow.svelte';
	import {DebugOperations} from '$lib/ui/debug';
	import {PendingOperationModal} from '$lib/ui/pending-operation';
	import TxObserverDebugOverlay from '$lib/debug/TxObserverDebugOverlay.svelte';

	import InsufficientFundsModal from '$lib/core/transaction/InsufficientFundsModal.svelte';
	import AccountCannotSendModal from '$lib/core/transaction/AccountCannotSendModal.svelte';
	import ErrorDetailsModal from '$lib/core/transaction/ErrorDetailsModal.svelte';

	const {connection} = getAppContext();
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

<!-- ORDER MATTERS when two of these are open at once.

     They share one container (#--layer-modals, see core/ui/modal/modal.svelte)
     and one z-index, so the one appended LAST paints on top. A dialog is
     appended when it opens, but dialogs that open in the SAME synchronous block
     are appended in the order their components appear here - and that is the
     normal case, because an action typically sets its own state and calls
     ensureConnected() before it ever awaits.

     So the connection flow comes last: it is always a sub-step of something
     else, and it has to be able to sit on top of whatever asked for it. Declared
     before the modals, a wallet picker raised from inside one of them opens
     UNDERNEATH it, and the click simply appears to hang. -->
<ConnectionFlow {connection} />
