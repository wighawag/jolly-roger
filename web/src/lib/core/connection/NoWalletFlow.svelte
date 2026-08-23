<script lang="ts">
	import {onMount} from 'svelte';
	import {Button} from '$lib/core/ui/button';
	import * as Modal from '$lib/core/ui/modal/index.js';
	import BasicModal from '$lib/core/ui/modal/basic-modal.svelte';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import {
		downloadWallets,
		mobileWallets,
		detectMobileWalletContext,
		type MobileWallet,
	} from './wallet-catalog';

	interface Props {
		onCancel?: () => void;
		/** When true, shows as a secondary option (no title, compact buttons) */
		secondary?: boolean;
	}

	let {onCancel, secondary = false}: Props = $props();

	let showDownloadModal = $state(false);
	let showMobileModal = $state(false);
	let isMobile = $state(false);
	let urlCopied = $state(false);

	onMount(() => {
		const hasInjectedProvider = !!(window as Window & {ethereum?: unknown})
			.ethereum;
		isMobile = detectMobileWalletContext({
			userAgent: navigator.userAgent,
			maxTouchPoints: navigator.maxTouchPoints,
			hasOntouchstart: 'ontouchstart' in window,
			innerWidth: window.innerWidth,
			hasInjectedProvider,
		});
	});

	async function handleMobileRedirect(wallet: MobileWallet) {
		const currentUrl = window.location.href;

		// Copy URL to clipboard first (user already informed via modal text)
		try {
			await navigator.clipboard.writeText(currentUrl);
		} catch {
			// Clipboard API may fail on some browsers, continue anyway
		}

		const deepLink = wallet.getLink(currentUrl);
		window.location.href = deepLink;
	}

	async function handleCopyUrl() {
		const currentUrl = window.location.href;
		try {
			await navigator.clipboard.writeText(currentUrl);
			urlCopied = true;
			setTimeout(() => {
				urlCopied = false;
			}, 2000);
		} catch {
			// Clipboard API may fail on some browsers
		}
	}
</script>

<!-- Main content -->
{#if secondary}
	<!-- Secondary mode: divider + wallet options -->
	<div class="relative my-4">
		<div class="absolute inset-0 flex items-center">
			<span class="w-full border-t border-input"></span>
		</div>
		<div class="relative flex justify-center text-xs uppercase">
			<span class="bg-background px-2 text-muted-foreground"
				>or use a wallet</span
			>
		</div>
	</div>
	<div class="flex flex-col gap-2">
		{#if isMobile}
			<Button
				variant="outline"
				class="w-full justify-start gap-3"
				onclick={() => (showMobileModal = true)}
			>
				<SmartphoneIcon class="h-4 w-4" />
				<span>Open in Wallet App</span>
			</Button>
		{/if}
		<Button
			variant="outline"
			class="w-full justify-start gap-3"
			onclick={() => (showDownloadModal = true)}
		>
			<DownloadIcon class="h-4 w-4" />
			<span>{isMobile ? 'Get a Mobile Wallet' : 'Get a Wallet'}</span>
		</Button>
	</div>
{:else}
	<!-- Primary mode: full layout with title -->
	<Modal.Title
		>{isMobile ? 'No Wallet App Found' : 'No Wallet Detected'}</Modal.Title
	>
	<div class="flex flex-col gap-3 py-2">
		<p class="text-sm text-muted-foreground">
			You need a web3 wallet to continue. Choose an option below:
		</p>
		<div class="flex flex-col gap-2">
			{#if isMobile}
				<Button
					variant="outline"
					class="h-14 justify-start gap-4 px-4"
					onclick={() => (showMobileModal = true)}
				>
					<SmartphoneIcon class="h-5 w-5" />
					<div class="flex-1 text-left">
						<div class="font-medium">Open in Wallet App</div>
						<div class="text-xs font-normal text-muted-foreground">
							Use your existing mobile wallet
						</div>
					</div>
				</Button>
			{/if}
			<Button
				variant="outline"
				class="h-14 justify-start gap-4 px-4"
				onclick={() => (showDownloadModal = true)}
			>
				<DownloadIcon class="h-5 w-5" />
				<div class="flex-1 text-left">
					<div class="font-medium">
						{isMobile ? 'Get a Mobile Wallet' : 'Download a Wallet'}
					</div>
					<div class="text-xs font-normal text-muted-foreground">
						{isMobile
							? 'Install from your app store'
							: 'Install a browser extension'}
					</div>
				</div>
			</Button>
		</div>
		{#if onCancel}
			<Button variant="outline" class="w-full" onclick={onCancel}>
				Cancel
			</Button>
		{/if}
	</div>
{/if}

<!-- Download Wallet Modal -->
<!-- `system`, like everything else in the connection flow: this is raised from
     inside the wallet picker, so it has to be able to cover it. -->
<BasicModal
	layer="system"
	title={isMobile ? 'Get a Mobile Wallet' : 'Get a Wallet'}
	openWhen={showDownloadModal}
	onCancel={() => (showDownloadModal = false)}
>
	<p class="mb-3 text-sm text-muted-foreground">
		{isMobile
			? 'Install a wallet app to connect:'
			: 'Install a wallet extension to connect:'}
	</p>
	<div
		class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-md border border-input bg-muted/50 p-2"
	>
		{#each downloadWallets as wallet}
			<a
				href={wallet.url}
				target="_blank"
				rel="noopener noreferrer"
				class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
			>
				<div
					class="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted"
				>
					{#if wallet.icon}
						<img
							src={wallet.icon}
							alt={wallet.name}
							class="h-full w-full object-contain"
						/>
					{:else}
						<!-- Fallback for empty icon strings - type assertion needed due to as const narrowing -->
						<span class="text-xs font-bold"
							>{(wallet as unknown as {name: string}).name[0]}</span
						>
					{/if}
				</div>
				<div class="flex-1">
					<div class="text-sm font-medium">{wallet.name}</div>
					<div class="text-xs text-muted-foreground">
						{isMobile
							? (wallet.mobileDescription ?? wallet.description)
							: wallet.description}
					</div>
				</div>
				<ExternalLinkIcon class="h-4 w-4 opacity-30" />
			</a>
		{/each}
	</div>
</BasicModal>

<!-- Mobile Wallet Modal -->
<BasicModal
	layer="system"
	title="Continue in Your Wallet"
	openWhen={showMobileModal}
	onCancel={() => (showMobileModal = false)}
>
	<p class="mb-3 text-sm text-muted-foreground">
		Open this site in your wallet's browser.
		<span class="font-medium text-primary"
			>The URL will be copied to your clipboard</span
		>
		so you can paste it manually if needed.
	</p>
	<div
		class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-md border border-input bg-muted/50 p-2"
	>
		{#each mobileWallets as wallet}
			<button
				onclick={() => handleMobileRedirect(wallet)}
				class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
			>
				<div
					class="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted"
				>
					{#if wallet.icon}
						<img
							src={wallet.icon}
							alt={wallet.name}
							class="h-full w-full object-contain"
						/>
					{:else}
						<span class="text-xs font-bold">{wallet.name[0]}</span>
					{/if}
				</div>
				<div class="flex-1">
					<div class="text-sm font-medium">{wallet.name}</div>
					<div class="text-xs text-muted-foreground">{wallet.description}</div>
				</div>
				<ExternalLinkIcon class="h-4 w-4 opacity-30" />
			</button>
		{/each}
	</div>

	<!-- Copy URL for unlisted wallets -->
	<div class="mt-4 border-t border-input pt-3">
		<p class="mb-2 text-xs text-muted-foreground">
			Wallet not listed? Copy this page's URL and paste it in your wallet's
			browser:
		</p>
		<button
			onclick={handleCopyUrl}
			class="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
		>
			{#if urlCopied}
				<CheckIcon class="h-4 w-4" />
				<span>URL Copied!</span>
			{:else}
				<CopyIcon class="h-4 w-4" />
				<span>Copy URL to Clipboard</span>
			{/if}
		</button>
	</div>
</BasicModal>
