<script lang="ts">
	import {Blockie} from '$lib/core/utils/ethereum/blockie';
	import * as Avatar from '$ui/avatar';
	import * as Popover from '$ui/popover';
	import Address from './Address.svelte';
	import type {HTMLImgAttributes} from 'svelte/elements';
	import {useENS} from '$lib/core/capabilities';
	import {createENSNameStore, createENSAvatarStore} from './ens';

	interface EthereumAvatarProps extends HTMLImgAttributes {
		address: `0x${string}`;
		offset?: number;
		showAddressOnTap?: boolean;
	}

	let {
		address,
		offset = 0,
		showAddressOnTap = false,
		...restProps
	}: EthereumAvatarProps = $props();

	let blockieUri = $derived(Blockie.getURI(address, offset));

	let popoverOpen = $state(false);

	// ENS avatar loads eagerly (seeded from cache); the ENS name loads lazily,
	// only once the popover opens. Both are optional and inert without the
	// capability, so the avatar falls back to a blockie.
	const ensService = useENS();
	const ensAvatarStore = createENSAvatarStore(ensService);
	const ensNameStore = createENSNameStore(ensService, {lazy: true});

	$effect(() => {
		ensAvatarStore.setAddress(address);
		ensNameStore.setAddress(address);
	});

	let ensAvatar = $derived($ensAvatarStore.avatar);
	let ensAvatarLoading = $derived($ensAvatarStore.loading);
	let ensName = $derived($ensNameStore.name);
	let ensNameLoading = $derived($ensNameStore.loading);

	// Compute the avatar URI - use ENS avatar if available, fallback to blockie
	let avatarUri = $derived(ensAvatar || blockieUri);
	let isBlockie = $derived(!ensAvatar);

	// Resolve the ENS name on demand when the popover opens.
	$effect(() => {
		if (popoverOpen && showAddressOnTap) {
			ensNameStore.resolve();
		}
	});

	const blockieImageStyle =
		'image-rendering: -moz-crisp-edges; image-rendering: -webkit-crisp-edges; image-rendering: crisp-edges; image-rendering: pixelated;';
</script>

{#if showAddressOnTap}
	<Popover.Root bind:open={popoverOpen}>
		<Popover.Trigger class="cursor-pointer rounded-full focus:outline-none">
			<Avatar.Root>
				{#if ensAvatarLoading}
					<!-- Show blockie while loading ENS avatar -->
					<Avatar.AvatarImage
						src={blockieUri}
						alt={address}
						style={blockieImageStyle}
					/>
				{:else}
					<Avatar.AvatarImage
						src={avatarUri}
						alt={address}
						style={isBlockie ? blockieImageStyle : undefined}
					/>
				{/if}
			</Avatar.Root>
		</Popover.Trigger>
		<Popover.Content
			class="w-auto min-w-64 border border-muted bg-popover p-4 text-popover-foreground shadow-xl shadow-black/25"
			side="top"
			sideOffset={8}
			collisionPadding={16}
			interactOutsideBehavior="defer-otherwise-close"
			onInteractOutside={(e) => {
				const target = e.target as HTMLElement;
				// Check if the target is a popover trigger - let defer-otherwise-close handle it
				const isPopoverTrigger = target?.closest(
					'[data-slot="popover-trigger"]',
				);
				if (!isPopoverTrigger && target) {
					// For non-popover elements, re-dispatch the click after a tick
					setTimeout(() => {
						target.click();
						if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
							target.focus();
						}
					}, 0);
				}
			}}
		>
			<Popover.Arrow class="ethereum-avatar-popover-arrow" />
			<div class="flex items-center gap-3">
				<!-- Larger avatar in the popover -->
				<Avatar.Root class="size-12 ring-2 ring-border">
					<Avatar.AvatarImage
						src={avatarUri}
						alt={address}
						style={isBlockie ? blockieImageStyle : undefined}
					/>
				</Avatar.Root>
				<div class="flex min-w-0 flex-col justify-center gap-1">
					{#if ensNameLoading}
						<div class="h-5 w-24 animate-pulse rounded bg-muted"></div>
					{:else if ensName}
						<span class="truncate font-semibold text-foreground">{ensName}</span
						>
					{/if}
					<Address
						value={address}
						resolveENS={false}
						size="sm"
						mono={true}
						class="text-muted-foreground"
						linkTo="auto"
					/>
				</div>
			</div>
		</Popover.Content>
	</Popover.Root>
{:else}
	<Avatar.Root>
		{#if ensAvatarLoading}
			<!-- Show blockie while loading ENS avatar -->
			<Avatar.AvatarImage
				src={blockieUri}
				alt={address}
				style={blockieImageStyle}
			/>
		{:else}
			<Avatar.AvatarImage
				src={avatarUri}
				alt={address}
				style={isBlockie ? blockieImageStyle : undefined}
			/>
		{/if}
	</Avatar.Root>
{/if}

<style>
	:global(.ethereum-avatar-popover-arrow) {
		fill: var(--muted) !important;
	}
	:global(.ethereum-avatar-popover-arrow svg) {
		fill: var(--muted) !important;
	}
	:global(.ethereum-avatar-popover-arrow polygon) {
		fill: var(--muted) !important;
	}
</style>
