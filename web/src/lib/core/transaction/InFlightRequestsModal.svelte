<script lang="ts">
	import * as Modal from '$lib/core/ui/modal/index.js';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import HelpCircleIcon from '@lucide/svelte/icons/help-circle';
	import {getAppContext} from '$lib';
	import {createInFlightReport, reportHeading} from './in-flight-view';

	// A SYSTEM overlay: its visibility is derived from domain state (the ledger),
	// not owned by it, so it survives navigation and is not registered with the
	// view-overlay registry. See ADR-0004 (`work` branch).
	const {inFlight} = getAppContext();

	// The rule for what to show, and the wording, both live in .ts: this is the
	// app admitting what it does not know, and neither is a rendering detail.
	const report = createInFlightReport(inFlight);

	// The heading depends on WHICH kind of news this is carrying, so it is decided
	// in .ts alongside the per-request wording rather than as a ternary here.
	let heading = $derived(reportHeading($report));
</script>

<Modal.Root
	openWhen={$report.length > 0}
	onCancel={() => inFlight.acknowledgeAll()}
>
	<Modal.Title>
		<span class="flex items-center gap-2">
			<HelpCircleIcon class="h-5 w-5" />
			{heading.title}
		</span>
	</Modal.Title>
	<Modal.Description>{heading.lead}</Modal.Description>

	<div class="my-4 flex max-h-[50vh] flex-col gap-3 overflow-y-auto">
		{#each $report as request (request.id)}
			<div class="rounded-md border border-input bg-muted/50 p-3">
				<div class="flex items-center justify-between gap-2">
					<span class="text-sm font-medium">{request.description}</span>
					<Address value={request.account} size="xs" mono />
				</div>
				<p class="mt-2 text-xs text-muted-foreground">{request.message}</p>
			</div>
		{/each}
	</div>

	<Modal.Footer>
		<!-- One button, and it says what it does. There is nothing to retry here
		     (retrying might send a second transaction) and nothing to cancel (the
		     request, if it exists, is not ours to withdraw). -->
		<Button onclick={() => inFlight.acknowledgeAll()}>Got it</Button>
	</Modal.Footer>
</Modal.Root>
