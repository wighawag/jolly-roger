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
	import {createSendingPulse} from '$lib/ui/in-flight/sending';
	import {effectiveGasPrice} from '$lib/core/connection/gasFee';
	import {
		CreditsIndicator,
		SignerBalance,
		createCreditsViewStore,
	} from '$lib/ui/credits/index.js';
	import {
		DelegationRow,
		createDelegationRowStore,
	} from '$lib/ui/delegation/index.js';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import AlertCircleIcon from '@lucide/svelte/icons/circle-alert';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import GitIcon from '$lib/icons/GitIcon.svelte';
	import {navbarMenuPrompt} from './overlays';

	let {
		repoURL,
		communityURL,
		currentPath,
	}: {
		repoURL?: string;
		communityURL?: string;
		/**
		 * The path being shown, as a GETTER so reading it here tracks the caller's
		 * reactive source. Passed in rather than read from the router, so the navbar
		 * does not name the framework (src/lib/kit/README.md), and so it still
		 * highlights the right link during SSR, when the navigation service is
		 * deliberately inert.
		 */
		currentPath: () => string;
	} = $props();

	const context = getAppContext();
	const {
		connection,
		accountData,
		accountBalance,
		gasFee,
		clock,
		deployments,
		overlays,
		inFlight,
	} = context;

	// The signer's own funding view (credits when the chain prices an action,
	// native currency otherwise). Every decision about what it shows lives in
	// lib/ui/credits; subscribing here is also what starts the signer-balance
	// poll, so a deployment with no signer never polls for one.
	const creditsView = createCreditsViewStore({
		...context,
		credits: context.credits,
	});

	// Whether this browser may act for the account, and whether that can be
	// withdrawn from here. Subscribing is also what starts the delegation poll,
	// so a page that never shows the panel never reads it.
	const delegationRow = createDelegationRowStore(context);

	// A transaction being handed over RIGHT NOW, which is the window before it
	// becomes an operation the badge below can count. Wordless and immediate on
	// purpose: see the two-surface note in $lib/ui/in-flight/sending.ts. This is
	// the rung that is on screen whenever the unload guard is armed, so it must
	// not be delayed AND must not be hidden by a connection step: it is rendered
	// outside the connected/disconnected branch below for that reason.
	const sending = createSendingPulse(inFlight);

	// The drawer closes itself on any navigation, and the back gesture closes it,
	// because it is a registered view overlay. Nav links below therefore carry no
	// close handler of their own.
	const menu = overlays.use(navbarMenuPrompt);
	$effect(() => menu.registerRenderer());

	let accountsOpen = $state(false);

	let hasMultipleAccounts = $derived(
		$connection.wallet?.accounts && $connection.wallet.accounts.length > 1,
	);

	// Watch all operations; the pending-badge counting rule lives in the view helper.
	let operations = $derived(accountData.watchField('operations'));
	let transactionCount = $derived(countPendingOperations($operations));

	// Derive formatted balance
	let formattedBalance = $derived.by(() => {
		if ($accountBalance.step === 'Loaded') {
			return formatBalance($accountBalance.value, 18, 6);
		}
		return null;
	});

	// Balance status store
	const balanceStatus = accountBalance.status;

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
		if ($menu.open) menu.close();
		else menu.open();
	}

	function isActive(path: string): boolean {
		const here = currentPath();
		if (path === '/') {
			return here === '/';
		}
		return here.startsWith(path);
	}
</script>

<!--navbar padding handled by scrollbar-gutter on desktop, needs-gutter-padding class adds padding on touch devices, see app.css-->
<!--
	`fixed`, NOT `sticky`, and the height shell in `+layout.svelte` is the reason.
	A sticky element can only stay pinned while its containing block is on screen,
	and the shell is exactly `100dvh` tall, so a sticky navbar's travel runs out
	after `100dvh - var(--navbar-height)` of scroll. Any page that can scroll
	further than that (content taller than about two viewports, which the HOME
	page already is on a short window or a phone in landscape) scrolled the
	navigation off the top and left the user with no way back. Out of flow, there
	is no containing block to run out of.

	The shell reserves the space with `pt-[var(--navbar-height)]`, which is why
	this is not a second hardcoded number: the height below and the padding there
	are the same variable.

	`w-full` still lines up with the content under it because
	`scrollbar-gutter: stable both-edges` (app.css) puts the gutters inside
	`html`'s padding box, so the containing block a fixed element resolves against
	is ALREADY inset by them. Measured: 1250 wide at left 15 in a 1280 viewport,
	no horizontal overflow. Drop that `scrollbar-gutter` line and this bar
	silently becomes a scrollbar wider than everything beneath it.
-->
<nav
	class="needs-gutter-padding fixed top-0 left-0 z-50 flex h-[var(--navbar-height)] w-full items-center justify-between bg-background py-4 shadow-md"
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
				<!-- The user's own account, shown here only when it is the ONLY balance
				     there is. With a signer, what the app spends is the in-app balance,
				     and two figures side by side invite the user to read the wrong one
				     when deciding whether they can still play. The account balance is
				     still a row in the panel, one tap away. -->
				{#if !$creditsView.visible}
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
				{/if}
				<CreditsIndicator view={$creditsView} onclick={() => menu.open()} />
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
					     on this rather than on any one feature's pending marker.

					     It PULSES while another transaction is being handed over, so
					     the count and the "one more on its way" are one mark rather
					     than two competing ones. Class only: the element, its testid
					     and its count are untouched by the animation. -->
					<span
						data-testid="pending-operations"
						data-count={transactionCount}
						class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground {$sending.sending
							? 'animate-pulse ring-2 ring-primary/50'
							: ''}"
					>
						{transactionCount > 99 ? '99+' : transactionCount}
					</span>
				{/if}
			{:else}
				<MenuIcon class="h-5 w-5" />
			{/if}

			{#if $sending.sending && transactionCount === 0}
				<!-- The same corner as the badge, before there is anything to count: a
				     transaction is on its way and has not become an operation yet. It
				     becomes the badge the moment it does, so the mark grows into a
				     number rather than one thing replacing another.

				     OUTSIDE the connected branch, unlike the badge. A dispatch can
				     outlive the step that started it (a wallet locking rebuilds its
				     state), and this is the rung sending.ts promises is up whenever the
				     unload guard is armed. Rendered inside, that promise would quietly
				     be "whenever the account button happens to be showing", and the
				     browser would ask about leaving with nothing at all on screen.

				     A SEPARATE testid, deliberately. `pending-operations` means "the
				     app is tracking N operations" and the e2e suite waits for it to
				     reach zero to mean settled (see e2e/fixtures/test.ts). Reusing it
				     for a dispatch with nothing recorded yet would make that wait
				     answer a different question.

				     `aria-hidden`, because the ordinary case is over in a few hundred
				     milliseconds and announcing every one of those is noise. That does
				     mean a screen reader gets NOTHING for a quick dispatch, not a
				     quieter version of it; the concession is spelled out in
				     $lib/ui/in-flight/sending.ts. -->
				<span
					data-testid="sending-transaction"
					aria-hidden="true"
					class="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center"
				>
					<span
						class="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-primary opacity-75"
					></span>
					<span class="relative inline-flex h-2 w-2 rounded-full bg-primary"
					></span>
				</span>
			{/if}
		</button>
	</div>
	<!-- Open state lives in the overlay registry, not in a local `$state`, which
	     is what makes a navigation close this panel and the back gesture dismiss
	     it. `onOpenChange` funnels bits-ui's own dismissals (ESC, click outside)
	     into the same single close path. -->
	<Drawer.Root
		open={$menu.open}
		onOpenChange={(open) => {
			if (!open) menu.close();
		}}
		direction="right"
	>
		<!-- Lands in the drawer layer, which is Drawer.Content's own default (see
		     lib/core/ui/layers.ts). That is what keeps the modals this panel opens,
		     Top up above all, ABOVE the panel itself. The target has to be on
		     Content, which supplies its own portal: a bare `<Drawer.Portal to="..." />`
		     sibling has no children and silently does nothing, which is what once put
		     this drawer on top of every modal. -->
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
							menu.close();
						}}
					>
						Disconnect
					</Button>
				</div>

				<!-- Balance & Transactions Section -->
				<div class="mt-4 flex flex-col gap-2 border-t border-border px-4 pt-4">
					<!-- FIRST, and renders itself only when a signer exists: this is what
					     pays for playing, so it is what a user checks. The account below
					     is what they own, which matters less often. -->
					<SignerBalance view={$creditsView} />

					<!-- Directly under what the browser SPENDS, because it is the other
					     half of the same thing: what this browser is allowed to do for
					     you, and how to take that back. An authorisation the user cannot
					     withdraw is the failure delegation exists to avoid, so it is a
					     row here rather than an entry point nobody can reach. -->
					<DelegationRow view={$delegationRow} />

					<div class="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2">
						<div class="flex items-center justify-between">
							<!-- The user's OWN account, and only theirs. It has no faucet
							     button any more: funding now runs through the top-up flow
							     above, which faucets the account that actually pays. A second
							     button here funded a third account and moved nobody closer to
							     being able to play. -->
							<span class="text-sm text-muted-foreground">Your account</span>
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
									onclick={() => accountBalance.update()}
								>
									<RefreshCwIcon class="h-3 w-3" />
									Retry
								</button>
							</div>
						{/if}
					</div>

					<a
						href={route('/transactions/')}
						class="{buttonVariants({variant: 'outline'})} justify-between"
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
				>
					Contracts
				</a>
				<a
					href={route('/explorer/')}
					class={buttonVariants({variant: 'outline'})}
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
