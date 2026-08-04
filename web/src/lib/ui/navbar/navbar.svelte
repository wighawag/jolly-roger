<script lang="ts">
	import {getAppContext, route} from '$lib';
	import Button, {buttonVariants} from '$lib/shadcn/ui/button/button.svelte';
	import EthereumAvatar from '../../core/ui/ethereum/EthereumAvatar.svelte';
	import {Spinner} from '$lib/shadcn/ui/spinner/index.js';
	import * as Drawer from '$lib/shadcn/ui/drawer/index.js';
	import * as Collapsible from '$lib/shadcn/ui/collapsible/index.js';
	import Address from '../../core/ui/ethereum/Address.svelte';
	import Badge from '$lib/shadcn/ui/badge/badge.svelte';
	import {formatBalance} from '$lib/core/utils/format/balance';
	import {countPendingOperations} from '$lib/view/operation';
	import {effectiveGasPrice} from '$lib/core/connection/gasFee';
	import {FaucetButton, hasFaucet} from '$lib/core/ui/faucet/index.js';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import AlertCircleIcon from '@lucide/svelte/icons/circle-alert';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import {page} from '$app/state';
	import GitIcon from '$lib/icons/GitIcon.svelte';

	let {
		repoURL,
		communityURL,
	}: {
		repoURL?: string;
		communityURL?: string;
	} = $props();

	const {
		connection,
		accountData,
		balance,
		ownerBalance,
		executionMode,
		gasFee,
		clock,
		deployments,
	} = getAppContext();

	// In signer mode the spending balance (top bar / `balance`) is the local
	// signer's, distinct from the authenticated account's (`ownerBalance`); show
	// both. In wallet mode they are the same account, so show a single balance.
	const showSignerBalances = executionMode === 'signer';

	let showMenu = $state(false);
	let accountsOpen = $state(false);

	let hasMultipleAccounts = $derived(
		$connection.wallet?.accounts && $connection.wallet.accounts.length > 1,
	);

	// Watch all operations; the pending-badge counting rule lives in the view helper.
	let operations = $derived(accountData.watchField('operations'));
	let transactionCount = $derived(countPendingOperations($operations));

	// Derive formatted balance
	let formattedBalance = $derived.by(() => {
		if ($balance.step === 'Loaded') {
			return formatBalance($balance.value, 18, 6);
		}
		return null;
	});

	// In wallet mode `ownerBalance` is the same store instance as `balance`
	// (see lib/context), so reading it unconditionally never double-polls.
	let formattedOwnerBalance = $derived.by(() => {
		if ($ownerBalance.step === 'Loaded') {
			return formatBalance($ownerBalance.value, 18, 6);
		}
		return null;
	});

	// Balance status store
	const balanceStatus = balance.status;

	// Format time ago for stale indicator (reactive to clock store)
	function formatTimeAgo(timestamp: number): string {
		const seconds = Math.floor(($clock - timestamp) / 1000);
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		return `${hours}h ago`;
	}

	// Gas fee store and status
	const gasFeeStatus = gasFee.status;

	// Format effective gas price in gwei (9 decimals).
	let formattedGasPrice = $derived.by(() => {
		if ($gasFee.step === 'Loaded') {
			return formatBalance(effectiveGasPrice($gasFee), 9, 6);
		}
		return null;
	});

	function toggleMenu() {
		showMenu = !showMenu;
	}

	function isActive(path: string): boolean {
		const currentPath = String(page.url.pathname);
		if (path === '/') {
			return currentPath === '/';
		}
		return currentPath.startsWith(path);
	}
</script>

<!--navbar padding handled by scrollbar-gutter on desktop, needs-gutter-padding class adds padding on touch devices, see app.css-->
<nav
	class="needs-gutter-padding sticky top-0 left-0 z-50 flex h-12 w-full items-center justify-between bg-background py-4 shadow-md"
>
	<div class="m-1 flex h-full items-center space-x-4">
		<span class="inline-flex items-baseline gap-4">
			<a
				href={route('/')}
				class="rounded px-2 py-1 text-sm transition-colors {isActive('/')
					? 'bg-primary/20 font-semibold text-primary'
					: 'text-muted-foreground hover:text-foreground hover:underline'}"
			>
				Home
			</a>
			<a
				href={route('/demo/')}
				class="rounded px-2 py-1 text-sm transition-colors {isActive('/demo')
					? 'bg-primary/20 font-semibold text-primary'
					: 'text-muted-foreground hover:text-foreground hover:underline'}"
			>
				Demo
			</a>
		</span>
		<div class="flex items-center space-x-2">
			{#if repoURL}
				<a
					href={repoURL}
					target="_blank"
					rel="noopener noreferrer"
					class="text-muted-foreground hover:text-foreground"
					aria-label="GitHub"
				>
					<GitIcon class="h-5 w-5 fill-white" />
				</a>
			{/if}
			{#if communityURL}
				<a
					href={communityURL}
					target="_blank"
					rel="noopener noreferrer"
					class="text-muted-foreground hover:text-foreground"
					aria-label="Discord"
				>
					<MessageCircleIcon class="h-5 w-5" />
				</a>
			{/if}
		</div>
	</div>

	<!-- `data-connected` is the single, authoritative connection signal for e2e.
	     Tests used to infer it from the balance text, but the balance span below
	     renders EMPTY while the balance is still loading, so an already-connected
	     app looked disconnected and the fixture re-ran the whole connect flow,
	     re-opening the account picker mid-test. This attribute tracks the same
	     predicate the branches below use, is always in the DOM, and does not
	     depend on the `sm:` breakpoint that hides the balance on small screens. -->
	<div
		class="relative flex h-full items-center space-x-2"
		data-testid="wallet-status"
		data-connected={connection.isTargetStepReached($connection)}
	>
		<!-- Connect Button / Connected Address -->
		{#if ($connection.step === 'Idle' && $connection.loading) || ($connection.step != 'Idle' && !connection.isTargetStepReached($connection))}
			<Button disabled class="m-1 flex h-8 items-center justify-center p-0">
				<Spinner /> Connect
			</Button>
		{:else if connection.isTargetStepReached($connection)}
			<div class="m-1 hidden h-8 items-center space-x-2 sm:flex">
				{#if $balanceStatus.error && formattedBalance !== null}
					<span class="flex items-center gap-1 text-sm text-muted-foreground">
						<AlertCircleIcon class="h-3 w-3 text-amber-500" />
						{formattedBalance}
						{$deployments.chain.nativeCurrency.symbol}
					</span>
				{:else if formattedBalance !== null}
					<span class="text-sm text-muted-foreground"
						>{formattedBalance}
						{$deployments.chain.nativeCurrency.symbol}</span
					>
				{:else if $balanceStatus.error}
					<span class="flex items-center gap-1 text-sm text-destructive">
						<AlertCircleIcon class="h-3 w-3" />
						Balance error
					</span>
				{/if}
			</div>
		{:else}
			<Button
				class="m-1 flex h-8 items-center justify-center p-0 px-3"
				onclick={() => connection.connect()}
			>
				Connect
			</Button>
		{/if}

		<!-- Drawer Button - Avatar when connected, Menu icon when disconnected -->
		<button
			class="relative m-1 flex h-8 w-8 items-center justify-center rounded-md focus:outline-none {$connection.step !==
			'SignedIn'
				? 'border border-input bg-background hover:bg-accent hover:text-accent-foreground'
				: ''}"
			onclick={toggleMenu}
			aria-label="Open menu"
		>
			{#if connection.isTargetStepReached($connection)}
				<EthereumAvatar address={$connection.account.address} />
				{#if transactionCount > 0}
					<!-- Rendered only while operations are in flight, so its absence
					     is the app's own "everything has settled" signal. Tests wait
					     on this rather than on any one feature's pending marker. -->
					<span
						data-testid="pending-operations"
						data-count={transactionCount}
						class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground"
					>
						{transactionCount > 99 ? '99+' : transactionCount}
					</span>
				{/if}
			{:else}
				<MenuIcon class="h-5 w-5" />
			{/if}
		</button>
	</div>
	<Drawer.Root bind:open={showMenu} direction="right">
		<Drawer.Portal to="#--layer-drawer" />
		<Drawer.Content class="select-text **:select-text">
			{#if connection.isTargetStepReached($connection)}
				<!-- Account Section -->
				<div class="flex flex-col gap-2 px-4 pt-4">
					<Collapsible.Root
						bind:open={accountsOpen}
						disabled={!hasMultipleAccounts}
					>
						<Collapsible.Trigger class="w-full" disabled={!hasMultipleAccounts}>
							<div
								class="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 {hasMultipleAccounts
									? 'cursor-pointer hover:bg-accent hover:text-accent-foreground'
									: 'cursor-default'}"
							>
								<div class="flex items-center gap-2">
									<div
										class="h-6 w-6 shrink-0 overflow-hidden rounded-full *:h-full *:w-full"
									>
										<EthereumAvatar address={$connection.account.address} />
									</div>
									<Address value={$connection.account.address} />
								</div>
								{#if hasMultipleAccounts}
									<ChevronDownIcon
										class="h-4 w-4 transition-transform {accountsOpen
											? 'rotate-180'
											: ''}"
									/>
								{/if}
							</div>
						</Collapsible.Trigger>
						{#if hasMultipleAccounts && $connection.wallet}
							<Collapsible.Content>
								<div
									class="mt-1 flex flex-col gap-1 rounded-md border border-input bg-muted/50 p-1"
								>
									{#each $connection.wallet.accounts as account}
										<button
											class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors {account ===
											$connection.account.address
												? 'bg-primary/20 text-primary'
												: 'hover:bg-accent hover:text-accent-foreground'}"
											onclick={() => {
												if (account !== $connection.account.address) {
													connection.connectToAddress(account);
													accountsOpen = false;
												}
											}}
										>
											<div
												class="h-5 w-5 shrink-0 overflow-hidden rounded-full *:h-full *:w-full"
											>
												<EthereumAvatar address={account} />
											</div>
											<Address value={account} />
											{#if account === $connection.account.address}
												<span class="ml-auto text-xs text-muted-foreground"
													>(current)</span
												>
											{/if}
										</button>
									{/each}
								</div>
							</Collapsible.Content>
						{/if}
					</Collapsible.Root>

					<Button
						class="w-full"
						variant="destructive"
						onclick={() => {
							connection.disconnect();
							showMenu = false;
						}}
					>
						Disconnect
					</Button>
				</div>

				<!-- Balance & Transactions Section -->
				<div class="mt-4 flex flex-col gap-2 border-t border-border px-4 pt-4">
					<div class="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2">
						<div class="flex items-center justify-between">
							<span class="text-sm text-muted-foreground"
								>{showSignerBalances ? 'Signer balance' : 'Balance'}</span
							>
							{#if $balanceStatus.loading && formattedBalance === null}
								<Spinner class="h-4 w-4" />
							{:else if formattedBalance !== null}
								<span class="font-medium"
									>{formattedBalance}
									{$deployments.chain.nativeCurrency.symbol}</span
								>
							{:else if $balanceStatus.error}
								<span class="text-sm text-destructive">Failed to load</span>
							{:else}
								<span class="text-sm text-muted-foreground">—</span>
							{/if}
						</div>

						{#if showSignerBalances}
							<div class="flex items-center justify-between">
								<span class="text-sm text-muted-foreground"
									>Account balance</span
								>
								{#if formattedOwnerBalance !== null}
									<span class="font-medium"
										>{formattedOwnerBalance}
										{$deployments.chain.nativeCurrency.symbol}</span
									>
								{:else}
									<Spinner class="h-4 w-4" />
								{/if}
							</div>
						{/if}

						{#if $balanceStatus.error}
							<div class="flex items-center justify-between">
								<span class="flex items-center gap-1 text-xs text-destructive">
									<AlertCircleIcon class="h-3 w-3" />
									{#if $balanceStatus.lastSuccessfulFetch}
										Stale — updated {formatTimeAgo(
											$balanceStatus.lastSuccessfulFetch,
										)}
									{:else}
										Unable to fetch balance
									{/if}
								</span>
								<button
									class="flex items-center gap-1 text-xs text-primary hover:underline"
									onclick={() => balance.update()}
								>
									<RefreshCwIcon class="h-3 w-3" />
									Retry
								</button>
							</div>
						{/if}

						{#if hasFaucet && $balance.step === 'Loaded' && $balance.value === 0n}
							<FaucetButton />
						{/if}
					</div>

					<a
						href={route('/transactions/')}
						class="{buttonVariants({variant: 'outline'})} justify-between"
						onclick={() => (showMenu = false)}
					>
						<span>Your Transactions</span>
						{#if transactionCount > 0}
							<Badge variant="secondary" class="ml-2">{transactionCount}</Badge>
						{/if}
					</a>
				</div>
			{:else}
				<Drawer.Header class="text-start">
					<Drawer.Title>You are disconnected</Drawer.Title>
				</Drawer.Header>
				<div class="px-4">
					<Button class="w-full" onclick={() => connection.connect()}>
						Connect
					</Button>
				</div>
			{/if}

			<!-- Network Info -->
			<div class="mt-4 flex flex-col gap-2 border-t border-border px-4 pt-4">
				<span class="text-xs tracking-wide text-muted-foreground uppercase"
					>Network</span
				>
				<div
					class="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"
				>
					<span class="text-sm text-muted-foreground">Gas Price</span>
					{#if $gasFeeStatus.loading && formattedGasPrice === null}
						<Spinner class="h-4 w-4" />
					{:else if formattedGasPrice !== null}
						<span class="font-medium">{formattedGasPrice} gwei</span>
					{:else if $gasFeeStatus.error}
						<span class="text-sm text-destructive">unavailable</span>
					{:else}
						<span class="text-sm text-muted-foreground">—</span>
					{/if}
				</div>
			</div>

			<!-- Developer Links -->
			<div class="mt-4 flex flex-col gap-2 border-t border-border px-4 pt-4">
				<span class="text-xs tracking-wide text-muted-foreground uppercase"
					>Developer</span
				>
				<a
					href={route('/contracts/')}
					class={buttonVariants({variant: 'outline'})}
					onclick={() => (showMenu = false)}
				>
					Contracts
				</a>
				<a
					href={route('/explorer/')}
					class={buttonVariants({variant: 'outline'})}
					onclick={() => (showMenu = false)}
				>
					Explorer
				</a>
			</div>

			<Drawer.Footer class="pt-2">
				<Drawer.Close class={buttonVariants({variant: 'outline'})}
					>Cancel</Drawer.Close
				>
			</Drawer.Footer>
		</Drawer.Content>
	</Drawer.Root>
</nav>
