<script lang="ts">
	import type {AbiParameter} from 'viem';
	import Label from '$lib/shadcn/ui/label/label.svelte';
	import Input from '$lib/shadcn/ui/input/input.svelte';
	import AddressInput from '$lib/core/ui/ethereum/AddressInput.svelte';
	import * as Alert from '$lib/shadcn/ui/alert';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import {
		getInputFieldType,
		getInputPlaceholder,
		getInputKey,
		getInputLabel,
	} from '../lib/utils';
	import {syncInputErrors} from '../lib/input-errors';

	interface Props {
		inputs: readonly AbiParameter[];
		values: Record<string, any>;
		errors: Record<string, string>;
		/**
		 * Prefixes every input's id, so two forms on one page do not both have an
		 * `input-0` (a label would then focus the other form's input). Without it
		 * the ids are `input-<index>`.
		 */
		idPrefix?: string;
	}

	let {inputs, values, errors, idPrefix = ''}: Props = $props();

	// An address is validated by AddressInput itself.
	$effect(() => {
		syncInputErrors(inputs, values, errors, {
			selfValidated: (input) => input.type === 'address',
		});
	});
</script>

<div class="space-y-3">
	{#each inputs as input, index (index)}
		<div class="space-y-1">
			<Label for={`${idPrefix}input-${index}`} class="text-sm">
				{getInputLabel(input, index)}
				<span class="ml-2 text-xs text-muted-foreground"
					>({input.internalType || input.type})</span
				>
			</Label>

			{#if input.type === 'address'}
				<AddressInput
					id={`${idPrefix}input-${index}`}
					bind:value={values[getInputKey(input, index)]}
					class="text-sm"
				/>
			{:else if getInputFieldType(input.type) === 'select'}
				<select
					id={`${idPrefix}input-${index}`}
					class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					bind:value={values[getInputKey(input, index)]}
				>
					<option value="">Select...</option>
					<option value="true">true</option>
					<option value="false">false</option>
				</select>
			{:else}
				<Input
					id={`${idPrefix}input-${index}`}
					type={getInputFieldType(input.type)}
					placeholder={getInputPlaceholder(input.type)}
					bind:value={values[getInputKey(input, index)]}
					class="font-mono text-sm"
				/>
			{/if}

			{#if errors[getInputKey(input, index)]}
				<Alert.Root
					variant="destructive"
					class="max-w-full overflow-hidden py-2"
				>
					<CircleAlertIcon class="h-4 w-4 shrink-0" />
					<Alert.Description
						class="overflow-wrap-break-word max-h-32 min-w-0 overflow-y-auto text-xs wrap-break-word"
					>
						{errors[getInputKey(input, index)]}
					</Alert.Description>
				</Alert.Root>
			{/if}
		</div>
	{/each}
</div>
