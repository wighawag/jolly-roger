<script lang="ts" module>
	import {cn} from '$lib/core/utils/tailwind';
	import type {HTMLAttributes} from 'svelte/elements';
	import {type VariantProps, tv} from 'tailwind-variants';

	export const txHashVariants = tv({
		base: 'inline-flex items-center gap-1',
		variants: {
			size: {
				xs: 'text-xs',
				sm: 'text-sm',
				default: 'text-base',
				lg: 'text-lg',
			},
			mono: {
				true: 'font-mono',
				false: '',
			},
		},
		defaultVariants: {
			size: 'default',
			mono: true,
		},
	});

	export type TxHashSize = VariantProps<typeof txHashVariants>['size'];

	export interface TransactionHashProps extends HTMLAttributes<HTMLSpanElement> {
		value: `0x${string}`;
		truncate?: {start: number; end: number} | false;
		size?: TxHashSize;
		mono?: boolean;
		showCopy?: boolean;
		linkTo?: 'internal' | 'external' | 'both' | 'auto' | false;
		ref?: HTMLSpanElement | null;
	}
</script>

<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import {useRoute} from '$lib/core/capabilities';
	import {createCopyToClipboard} from '$lib/core/ui/clipboard/copy-to-clipboard';
	import {truncateHex} from '$lib/core/utils/format';
	import {
		getBlockExplorerTxUrl,
		hasBlockExplorer,
		resolveLinkTo,
	} from '$lib/core/utils/ethereum/blockExplorer';

	let {
		class: className,
		value,
		truncate = {start: 6, end: 4},
		size = 'default',
		mono = true,
		showCopy = true,
		linkTo = false,
		ref = $bindable(null),
		...restProps
	}: TransactionHashProps = $props();

	// Ambient route resolver - falls back to base-path resolution when unprovided.
	const route = useRoute();
	const clipboard = createCopyToClipboard();

	function formatHash(hash: string): string {
		if (truncate === false) return hash;
		return truncateHex(hash, truncate);
	}

	async function copyHash(event: MouseEvent) {
		event.stopPropagation();
		event.preventDefault();
		await clipboard.copy(value);
	}

	const displayText = $derived(formatHash(value));
	const internalUrl = $derived(route(`/explorer/tx/${value}`));
	const externalUrl = $derived(getBlockExplorerTxUrl(value));
	const resolvedLinkTo = $derived(resolveLinkTo(linkTo));
	// When internal is available (internal or both), text links to internal
	const showInternalLink = $derived(
		resolvedLinkTo === 'internal' || resolvedLinkTo === 'both',
	);
	// When external-only, text links directly to external (no icon)
	const showExternalAsTextLink = $derived(
		resolvedLinkTo === 'external' && hasBlockExplorer(),
	);
	// When both, show external icon as secondary action
	const showExternalIcon = $derived(
		resolvedLinkTo === 'both' && hasBlockExplorer(),
	);
</script>

<span
	bind:this={ref}
	data-slot="transaction-hash"
	class={cn(txHashVariants({size, mono}), className)}
	{...restProps}
>
	{#if showInternalLink}
		<a
			href={internalUrl}
			data-slot="tx-hash-link"
			class="text-primary hover:underline"
		>
			{displayText}
		</a>
	{:else if showExternalAsTextLink && externalUrl}
		<a
			href={externalUrl}
			target="_blank"
			rel="noopener noreferrer"
			data-slot="tx-hash-link"
			class="text-primary hover:underline"
		>
			{displayText}
		</a>
	{:else}
		<span data-slot="tx-hash-text">{displayText}</span>
	{/if}

	{#if showCopy}
		<button
			type="button"
			class="inline-flex size-4 shrink-0 cursor-copy items-center justify-center rounded opacity-50 transition-opacity hover:opacity-100 focus:opacity-100"
			title="Copy transaction hash"
			onclick={copyHash}
			aria-label="Copy transaction hash"
		>
			{#if $clipboard}
				<CheckIcon class="size-3 text-green-500" />
			{:else}
				<CopyIcon class="size-3" />
			{/if}
		</button>
	{/if}

	{#if showExternalIcon && externalUrl}
		<a
			href={externalUrl}
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex size-4 shrink-0 items-center justify-center rounded opacity-50 transition-opacity hover:opacity-100 focus:opacity-100"
			title="View in block explorer"
			aria-label="View in block explorer"
		>
			<ExternalLinkIcon class="size-3" />
		</a>
	{/if}
</span>
