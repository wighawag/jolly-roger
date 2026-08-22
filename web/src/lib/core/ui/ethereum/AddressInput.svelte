<script lang="ts" module>
	import {cn} from '$lib/core/utils/tailwind';
	import type {HTMLInputAttributes} from 'svelte/elements';
	import {type VariantProps, tv} from 'tailwind-variants';

	export const addressInputVariants = tv({
		base: 'flex flex-col gap-1',
		variants: {
			size: {
				sm: '',
				default: '',
				lg: '',
			},
		},
		defaultVariants: {
			size: 'default',
		},
	});

	export type AddressInputSize = VariantProps<
		typeof addressInputVariants
	>['size'];

	export interface AddressInputProps extends Omit<
		HTMLInputAttributes,
		'value' | 'size'
	> {
		/**
		 * The resolved address (bindable). This is the actual address value
		 * that will be used - either a validated hex address or an ENS-resolved address.
		 */
		value?: `0x${string}` | null;
		/**
		 * The raw user input (bindable). Use this to access/control the text input directly.
		 */
		rawInput?: string;
		/**
		 * Size variant for the input
		 */
		size?: AddressInputSize;
		/**
		 * Debounce time in milliseconds for ENS resolution (default: 500ms)
		 */
		debounceMs?: number;
		/**
		 * Show a blockie avatar for valid addresses
		 */
		showBlockie?: boolean;
		/**
		 * Reference to the input element
		 */
		ref?: HTMLInputElement | null;
	}
</script>

<script lang="ts">
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import {truncateHex} from '$lib/core/utils/format';
	import {isENSName} from './address-input';
	import {useENS} from '$lib/core/capabilities';
	import {createAddressResolverStore} from './address-resolver';
	import ImgBlockie from './ImgBlockie.svelte';
	import Address from './Address.svelte';

	let {
		class: className,
		value = $bindable(),
		rawInput = $bindable(''),
		size = 'default',
		debounceMs = 500,
		showBlockie = true,
		placeholder = '0x... or ENS name',
		disabled = false,
		ref = $bindable(null),
		...restProps
	}: AddressInputProps = $props();

	// ENS classification, debounce, and resolution state live in the store. It
	// keeps our bindable `value` in sync via the onResolved callback.
	const ensService = useENS();
	const resolver = createAddressResolverStore(
		ensService,
		(address) => {
			value = address;
		},
		() => debounceMs,
	);
	let resolving = $derived($resolver.resolving);
	let resolvedAddress = $derived($resolver.resolvedAddress);
	let resolveError = $derived($resolver.error);

	// React to rawInput changes
	$effect(() => {
		resolver.update(rawInput);
	});

	// Determine the status for visual feedback
	const status = $derived.by(() => {
		if (resolving) return 'resolving';
		if (resolveError) return 'error';
		if (resolvedAddress) return 'valid';
		if (rawInput.trim().length === 0) return 'empty';
		return 'typing';
	});

	// Show resolved address when it's different from input (i.e., ENS was resolved)
	const showResolvedAddress = $derived(
		resolvedAddress && isENSName(rawInput) && !resolving,
	);

	// Format address for display (truncated)
	function formatAddress(addr: string): string {
		return truncateHex(addr, {start: 4, end: 4});
	}
</script>

<div class={cn(addressInputVariants({size}), className)}>
	<div class="relative flex items-center">
		{#if showBlockie && resolvedAddress && !resolving}
			<div class="absolute left-2 flex items-center">
				<ImgBlockie address={resolvedAddress} class="size-5 rounded-sm" />
			</div>
		{/if}

		<input
			bind:this={ref}
			type="text"
			data-slot="address-input"
			class={cn(
				'flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 font-mono text-base shadow-xs ring-offset-background transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
				'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
				status === 'error' &&
					'border-destructive ring-destructive/20 dark:ring-destructive/40',
				status === 'valid' &&
					'border-green-500 ring-green-500/20 dark:ring-green-500/40',
				showBlockie && resolvedAddress && !resolving && 'pl-9',
				'pr-8',
			)}
			{placeholder}
			{disabled}
			bind:value={rawInput}
			aria-invalid={status === 'error'}
			{...restProps}
		/>

		<div class="absolute right-2 flex items-center">
			{#if resolving}
				<LoaderCircleIcon class="size-4 animate-spin text-muted-foreground" />
			{:else if status === 'valid'}
				<CheckCircleIcon class="size-4 text-green-500" />
			{:else if status === 'error'}
				<AlertCircleIcon class="size-4 text-destructive" />
			{/if}
		</div>
	</div>

	{#if showResolvedAddress}
		<div class="flex items-center gap-1 text-xs text-muted-foreground">
			<span>Resolved:</span>
			<Address value={resolvedAddress!} resolveENS={false} linkTo="auto" />
		</div>
	{/if}

	{#if resolveError}
		<div class="text-xs text-destructive">{resolveError}</div>
	{/if}
</div>
