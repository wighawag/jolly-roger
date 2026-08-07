<script lang="ts">
	import {getAppContext, params} from '$lib';
	import ConnectionFlow from '$lib/core/connection/ConnectionFlow.svelte';
	import {DebugOperations} from '$lib/ui/debug';
	import {PendingOperationModal} from '$lib/ui/pending-operation';
	import TxObserverDebugOverlay from '$lib/debug/TxObserverDebugOverlay.svelte';

	import InsufficientFundsModal from '$lib/core/transaction/InsufficientFundsModal.svelte';
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

<ConnectionFlow {connection} />
<!-- The PAYMENT connection needs its own flow, or any step that requires the
     user (choosing between two installed wallets, approving a connection)
     happens with nothing on screen: the click just hangs. It is a separate
     connection, so one flow cannot serve both. Renders nothing until that
     connection actually starts connecting, which only a payment triggers. -->
<ConnectionFlow connection={payment.connection} />
<PendingOperationModal />

<InsufficientFundsModal />
<AccountCannotSendModal />
<ErrorDetailsModal />
