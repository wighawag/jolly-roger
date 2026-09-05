<script lang="ts">
	import {getAppContext} from '$lib';
	import * as Modal from '$lib/core/ui/modal/index.js';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import {Badge} from '$lib/shadcn/ui/badge/index.js';
	import {Spinner} from '$lib/shadcn/ui/spinner/index.js';
	import OperationDetailsView from './OperationDetailsView.svelte';
	import TransactionAttemptsList from './TransactionAttemptsList.svelte';
	import GasPricingForm from './GasPricingForm.svelte';
	import ConfirmDismissDialog from './ConfirmDismissDialog.svelte';
	import ConfirmCancelDialog from './ConfirmCancelDialog.svelte';
	import type {GasPrice} from '$lib/core/connection/gasFee';
	import {
		cancelConfirmPrompt,
		dismissConfirmPrompt,
		pendingOperationOverlay,
		resubmitPrompt,
		watchOverlayOperation,
	} from './overlays';
	import {
		deriveMinGasPrice,
		resubmitOperation,
		cancelOperation,
		dismissOperation,
		wrongAccountMessage,
	} from './operation-actions';

	const context = getAppContext();
	const {overlays, accountData} = context;

	// The inspector, and the three questions it can ask. Each is its own overlay,
	// so the back gesture unwinds them one at a time and closing the inspector
	// closes whatever it had open on top.
	const inspector = overlays.use(pendingOperationOverlay);
	const dismissConfirm = overlays.use(dismissConfirmPrompt);
	const resubmitForm = overlays.use(resubmitPrompt);
	const cancelConfirm = overlays.use(cancelConfirmPrompt);

	$effect(() => inspector.registerRenderer());
	$effect(() => dismissConfirm.registerRenderer());
	$effect(() => resubmitForm.registerRenderer());
	$effect(() => cancelConfirm.registerRenderer());

	// Followed live, never copied: see watchOverlayOperation.
	const liveOperation = watchOverlayOperation(inspector, accountData);

	// Transient state of an action being taken, which belongs to this view and to
	// nothing else: it is not what any dialog is ABOUT, so it is not payload.
	let isSubmitting = $state(false);
	let resubmitError = $state<string | null>(null);
	let cancelError = $state<string | null>(null);

	let inspected = $derived($liveOperation);
	let operation = $derived(
		inspected.status === 'found' ? inspected.operation : null,
	);
	let operationKey = $derived(inspected.key ?? null);

	// Get status string from the observer's state
	let status = $derived(operation?.state?.inclusion || 'Fetching');

	// Transaction is final when included or dropped - no confirmation needed for dismiss
	let isFinal = $derived(status === 'Included' || status === 'Dropped');

	// Minimum gas price for resubmit validation (previous tx's fee).
	let minGasPrice = $derived(deriveMinGasPrice(operation));

	// The operation can disappear from under an open inspector: account data drops
	// it once it finalizes successfully. The inspector deliberately STAYS OPEN and
	// says so, rather than vanishing mid-read: the user opened this to watch a
	// transaction, and having the answer arrive by the window disappearing is
	// worse than the stale view this design replaced. Closing stays a thing the
	// user does (or that an action they took does, like Dismiss).

	// Whatever closed it (button, ESC, click outside, back gesture, navigation),
	// the next open starts clean.
	$effect(() => {
		if (!$inspector.open) {
			isSubmitting = false;
			resubmitError = null;
			cancelError = null;
		}
	});

	// And per PROMPT, not only per inspector. An error belongs to the attempt that
	// produced it: dismissing the gas form and opening it again must not greet the
	// user with a failure from a submission they already walked away from. The
	// dialogs used to clear their own error in their cancel handler; routing every
	// dismissal through the overlay took that with it, so it lives here now, where
	// it also covers the paths those handlers never saw (back gesture, navigation).
	$effect(() => {
		if (!$resubmitForm.open) resubmitError = null;
	});
	$effect(() => {
		if (!$cancelConfirm.open) cancelError = null;
	});

	async function handleDismiss() {
		if (operationKey) {
			dismissOperation(context, operationKey);
			inspector.close();
		}
	}

	async function handleResubmit(gasPrice: GasPrice) {
		if (!operation || !operationKey) return;

		try {
			isSubmitting = true;
			resubmitError = null;

			const result = await resubmitOperation(context, {
				operation,
				operationKey,
				gasPrice,
			});
			if (result.status === 'submitted') {
				inspector.close();
			} else if (result.status === 'wrong-account') {
				resubmitError = wrongAccountMessage(result.expected);
			} else if (result.status === 'error') {
				resubmitError = result.message;
			}
		} finally {
			isSubmitting = false;
		}
	}

	async function handleCancel() {
		if (!operation) return;

		try {
			isSubmitting = true;
			cancelError = null;

			const result = await cancelOperation(context, {operation});
			if (result.status === 'submitted') {
				inspector.close();
			} else if (result.status === 'wrong-account') {
				cancelError = wrongAccountMessage(result.expected);
			} else if (result.status === 'error') {
				cancelError = result.message;
			}
		} finally {
			isSubmitting = false;
		}
	}
</script>

<!--
	`openWhen` says whether the overlay is OPEN, never whether its data has
	arrived. Two reasons, and the second is the sharp one:

	1. Reloading a link to an operation would otherwise show nothing at all until
	   account data had loaded, instead of this dialog with a loading body.
	2. Within a layer, dialogs are painted in the order they MOUNT (bits-ui's
	   portal appends on open and removes on close). A modal whose mounting
	   condition can flicker therefore re-appends itself AFTER any dialog it
	   raised, so a parent would paint over its own confirmation prompt. Keeping
	   the mounting condition free of data makes that impossible rather than
	   unlikely.
-->
<!-- A VIEW overlay: it is here because the user clicked a pending operation, not
     because domain state raised it. So `'modal'`, and the three dialogs it opens
     below are in the same layer, above it by declaration order. Stated rather
     than defaulted; see the `layer` prop in core/ui/modal/modal.svelte. -->
<Modal.Root
	layer="modal"
	openWhen={$inspector.open}
	onCancel={() => inspector.close()}
>
	{#if inspected.status === 'loading'}
		<Modal.Title>Pending Transaction</Modal.Title>
		<div class="flex items-center gap-3 py-6 text-muted-foreground">
			<Spinner class="h-4 w-4" />
			Loading this transaction.
		</div>
	{:else if inspected.status === 'cleared' || inspected.status === 'missing'}
		<Modal.Title>
			<span class="flex items-center gap-2">
				{inspected.status === 'cleared'
					? 'Transaction Complete'
					: 'Transaction'}
				<Badge variant="outline">Cleared</Badge>
			</span>
		</Modal.Title>
		<p class="py-4 text-sm text-muted-foreground">
			{#if inspected.status === 'cleared'}
				This transaction finalized successfully and was removed from your list.
			{:else}
				This transaction is not in your list. It may have finalized and been
				removed, or the link may be for another account.
			{/if}
		</p>
		<Modal.Footer>
			<Button variant="outline" onclick={() => inspector.close()}>Close</Button>
		</Modal.Footer>
	{:else if operation}
		<Modal.Title>
			<span class="flex items-center gap-2">
				Pending Transaction
				<Badge variant="destructive">{status}</Badge>
			</span>
		</Modal.Title>

		<div class="space-y-4 py-4">
			<OperationDetailsView {operation} />

			<TransactionAttemptsList attempts={operation.attempts} />
		</div>

		<Modal.Footer>
			<Button
				variant="outline"
				onclick={() => (isFinal ? handleDismiss() : dismissConfirm.open())}
			>
				Dismiss
			</Button>
			{#if status !== 'Dropped' && status !== 'Included'}
				<Button variant="secondary" onclick={() => resubmitForm.open()}>
					Resubmit
				</Button>
				<Button variant="destructive" onclick={() => cancelConfirm.open()}>
					Cancel Transaction
				</Button>
			{/if}
		</Modal.Footer>
	{/if}
</Modal.Root>

<!-- Sub-dialogs -->
<ConfirmDismissDialog
	open={$dismissConfirm.open}
	onConfirm={handleDismiss}
	onCancel={() => dismissConfirm.close()}
	{status}
/>

<GasPricingForm
	open={$resubmitForm.open}
	onSubmit={handleResubmit}
	onCancel={() => resubmitForm.close()}
	{isSubmitting}
	{minGasPrice}
	errorMessage={resubmitError}
/>

<ConfirmCancelDialog
	open={$cancelConfirm.open}
	onConfirm={handleCancel}
	onCancel={() => cancelConfirm.close()}
	{isSubmitting}
	errorMessage={cancelError}
/>
