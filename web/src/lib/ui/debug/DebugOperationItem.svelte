<script lang="ts">
	import {Badge} from '$lib/shadcn/ui/badge';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import CircleQuestionMarkIcon from '@lucide/svelte/icons/circle-help';
	import type {OnchainOperation} from '$lib/account/AccountData';
	import type {Readable} from 'svelte/store';
	import {
		getOperationName,
		getOperationStatusInfo,
		type OperationStatusKind,
	} from '$lib/view/operation';

	interface Props {
		operationStore: Readable<OnchainOperation | undefined>;
	}

	let {operationStore}: Props = $props();

	// Map the semantic status kind to an icon component (presentation only).
	const statusIcons: Record<OperationStatusKind, typeof CircleCheckIcon> = {
		pending: ClockIcon,
		notFound: CircleQuestionMarkIcon,
		dropped: TriangleAlertIcon,
		success: CircleCheckIcon,
		failed: CircleXIcon,
		unknown: CircleQuestionMarkIcon,
	};
</script>

{#if $operationStore}
	{@const state = $operationStore.state}
	{@const statusInfo = getOperationStatusInfo(state)}
	{@const StatusIcon = statusIcons[statusInfo.kind]}
	<div class="flex items-center justify-between gap-2 px-2 py-1 text-xs">
		<div class="flex min-w-0 items-center gap-1.5">
			<StatusIcon class="h-3 w-3 shrink-0" />
			<span class="truncate"
				>{getOperationName($operationStore, 'Unknown')}</span
			>
		</div>
		<div class="flex items-center gap-1">
			{#if state?.final}
				<Badge variant="outline" class="h-4 shrink-0 px-1.5 py-0 text-[10px]">
					Final
				</Badge>
			{/if}
			<Badge
				variant={statusInfo.variant}
				class="h-4 shrink-0 px-1.5 py-0 text-[10px]"
			>
				{statusInfo.label}
			</Badge>
		</div>
	</div>
{/if}
