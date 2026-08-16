<script lang="ts">
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import EthereumAvatar from '$lib/core/ui/ethereum/EthereumAvatar.svelte';
	import {Button} from '$lib/shadcn/ui/button';
	import type {
		AnyConnectionStore,
		UnderlyingEthereumProvider,
	} from '@etherplay/connect';
	import * as Modal from '$lib/core/ui/modal/index.js';
	import BasicModal from '../ui/modal/basic-modal.svelte';
	import NoWalletFlow from './NoWalletFlow.svelte';
	import GoogleIcon from '$lib/core/ui/oauth/GoogleIcon.svelte';
	import FacebookIcon from '$lib/core/ui/oauth/FacebookIcon.svelte';
	import {
		hasPendingWalletRequest,
		walletEntryMode,
		canDismissConnection,
		resolveSignInAddress,
		hasSwappedAccount,
		signInAdoptingSwap,
		signInToAccount,
		combinesAccountChoiceWithSignIn,
		effectiveAccountSelection,
	} from './connection-flow';
	import {connectionFailureView} from './refusal';
	import {dev} from '$lib';

	interface Props {
		connection: AnyConnectionStore<UnderlyingEthereumProvider>;
	}

	let {connection}: Props = $props();

	let email: string = $state('');
	let emailInput: HTMLInputElement | undefined = $state(undefined);

	// Whether the nested wallet picker (for the multi-wallet case) is open. This
	// is UI-only state: the connection store stays in `WalletToChoose` throughout.
	let walletPickerOpen: boolean = $state(false);

	// Flow interpretation (burner-wallet phase + pending request) lives in the helper.
	let pendingRequest = $derived(hasPendingWalletRequest($connection));

	// Whether the connect modal offers sign-in options besides wallets (the
	// email input under hosted sign-in). Controls the modal's layout, including
	// whether a multi-wallet list is collapsed behind a button or shown inline.
	// NOTE: the email/dev blocks below still use the inline
	// `connection.targetStep == 'SignedIn' && !connection.walletOnly` check:
	// that expression narrows the store union so `connect` accepts the
	// email/mnemonic mechanisms; this boolean does not narrow.
	let hasOtherSignInOptions = $derived(
		connection.targetStep == 'SignedIn' && !connection.walletOnly,
	);

	// How to present the wallet entry point: none / single / list / collapsed.
	let walletEntry = $derived(
		walletEntryMode($connection.wallets, hasOtherSignInOptions),
	);

	// The account a sign-in should adopt (handles live account swaps), and whether
	// the user swapped their active account while on the confirm screen.
	let signInAddress = $derived(resolveSignInAddress($connection));

	// Whether clicking away (or escape) should tear the flow down. See
	// canDismissConnection for why it must not while the wallet holds a request.
	//
	// Passed as `undefined` rather than as a guarded handler when dismissal is
	// refused, because Modal.Root derives its affordances from whether it got one
	// (see core/ui/modal/modal.svelte: showCloseButton, interactOutsideBehavior,
	// escapeKeydownBehavior). A handler that decides internally would leave the
	// close X on screen doing nothing and swallow escape silently, which is worse
	// than refusing: it offers an exit that is not there.
	let dismissable = $derived(canDismissConnection($connection));
	const dismiss = () => connection.cancel();
	let swappedAccount = $derived(hasSwappedAccount($connection));

	// What a failed attempt should say. Under @etherplay/connect 0.6.0 the wallet
	// host's own refusals reach the app instead of being flattened into a
	// cancellation, and their messages are written for a developer reading a
	// console, so the wording is decided in core/connection/refusal rather than
	// printed raw. Undefined when nothing is resting on the connection.
	let failure = $derived(connectionFailureView($connection.error));

	// Combined choose+sign-in modal (multi-account wallet under a sign-in
	// target): which row the user explicitly picked (undefined = follow the
	// wallet's active account), and whether an adopt-then-sign action is in
	// flight. The latter also suppresses the separate confirm modal during the
	// transient WalletConnected step between adoption and signature request,
	// which would otherwise flash mid-action.
	let chosenAccount: `0x${string}` | undefined = $state(undefined);
	let signingInFromChooser = $state(false);
	let combinedChooseAndSignIn = $derived(
		combinesAccountChoiceWithSignIn(connection),
	);

	let selectedAccount = $derived(
		$connection.step === 'ChooseWalletAccount'
			? effectiveAccountSelection($connection.wallet.accounts, chosenAccount)
			: undefined,
	);

	async function chooseAndSignIn() {
		if (!selectedAccount) return;
		signingInFromChooser = true;
		try {
			await signInToAccount(connection, selectedAccount);
		} catch {
			// Cancelled / rejected / timed out: the store settles on its own step
			// (e.g. WalletConnected -> the confirm screen serves as the fallback).
		} finally {
			signingInFromChooser = false;
			chosenAccount = undefined;
		}
	}
</script>

<Modal.Root openWhen={$connection.step == 'WaitingForWalletConnection'}>
	<Modal.Title>Waiting for Wallet Connection...</Modal.Title>
	Please Accept Connection Request...
</Modal.Root>

<!-- Error display: shows when a connection attempt failed and the flow fell
     back to a resting state (Idle / MechanismToChoose / WalletToChoose) with an
     error. Without this the error is set on the store but never rendered, so a
     fast rejection (e.g. werust's 4100) just flashes the waiting modal and
     silently returns to idle.

     ALSO WHERE A REFUSAL LANDS, since 0.6.0: a declined required permission or
     a blocked cross-origin request now rests here with its reason attached,
     where before it was indistinguishable from a closed popup and showed
     nothing at all. Dismiss is the only action, deliberately: neither refusal
     is answered by pressing the same button again. -->
<BasicModal
	title={failure?.title ?? 'Connection Failed'}
	openWhen={!!failure &&
		($connection.step === 'Idle' ||
			$connection.step === 'MechanismToChoose' ||
			$connection.step === 'WalletToChoose')}
	cancel={{label: 'Dismiss', onclick: () => connection.clearError()}}
>
	<p class="text-sm text-muted-foreground">{failure?.message}</p>
	{#if failure?.detail}
		<!-- Addressed to whoever configured the app rather than to the person
		     reading it, so it is quieter and separate rather than folded into the
		     sentence above. -->
		<p class="mt-2 text-xs text-muted-foreground">{failure.detail}</p>
	{/if}
</BasicModal>

<Modal.Root
	openWhen={$connection.step == 'WalletToChoose' ||
		$connection.step == 'MechanismToChoose'}
	onCancel={dismissable ? dismiss : undefined}
	elementToFocus={emailInput}
>
	{#if connection.targetStep == 'SignedIn' && !connection.walletOnly}
		<Modal.Title>Sign In</Modal.Title>
		<!-- Email option first -->
		<div class="mb-4 flex flex-col gap-3">
			<input
				bind:this={emailInput}
				bind:value={email}
				placeholder="Enter your email"
				class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:outline-none"
			/>
			<Button
				class="w-full"
				onclick={() =>
					connection.connect({
						type: 'email',
						mode: 'otp',
						email,
					})}
			>
				Sign in with Email
			</Button>
		</div>

		<!-- Social login options -->
		<div class="mb-4 flex flex-col gap-3">
			<Button
				variant="outline"
				class="w-full justify-center gap-3"
				onclick={() =>
					connection.connect({
						type: 'oauth',
						provider: {id: 'google'},
						usePopup: false,
					})}
			>
				<GoogleIcon class="h-5 w-5" />
				<span>Continue with Google</span>
			</Button>
			<Button
				variant="outline"
				class="w-full justify-center gap-3"
				onclick={() =>
					connection.connect({
						type: 'oauth',
						provider: {id: 'facebook'},
						usePopup: false,
					})}
			>
				<FacebookIcon class="h-5 w-5" />
				<span>Continue with Facebook</span>
			</Button>
		</div>
	{/if}

	<!-- Wallet entry point -->
	{#if walletEntry === 'single'}
		<!-- Exactly one wallet: a single button that connects to it directly. -->
		<Button
			variant="outline"
			class="w-full justify-center gap-3"
			onclick={() =>
				connection.connect({
					type: 'wallet',
					name: $connection.wallets[0].info.name,
				})}
		>
			<div class="h-5 w-5 shrink-0 overflow-hidden rounded-full">
				<img
					src={$connection.wallets[0].info.icon}
					alt={$connection.wallets[0].info.name}
					class="h-full w-full object-contain"
				/>
			</div>
			<span>Connect {$connection.wallets[0].info.name}</span>
		</Button>
	{:else if walletEntry === 'collapsed'}
		<!-- Several wallets sharing the modal with other sign-in options: one
		     button that opens the wallet picker. -->
		<Button
			variant="outline"
			class="w-full justify-center gap-3"
			onclick={() => (walletPickerOpen = true)}
		>
			<span>Connect a Wallet</span>
		</Button>
	{:else if walletEntry === 'list'}
		<!-- Several wallets and nothing else to offer (wallet-only auth): show
		     the list directly, no intermediate button. -->
		<Modal.Title>
			{$connection.wallets.length} wallets available, choose one
		</Modal.Title>
		<div
			class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-md border border-input bg-muted/50 p-2"
		>
			{#each $connection.wallets as wallet}
				<button
					class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
					onclick={() =>
						connection.connect({type: 'wallet', name: wallet.info.name})}
				>
					<div class="h-6 w-6 shrink-0 overflow-hidden rounded-full">
						<img
							src={wallet.info.icon}
							alt={wallet.info.name}
							class="h-full w-full object-contain"
						/>
					</div>
					<div class="flex flex-col">
						<span class="text-sm font-medium">{wallet.info.name}</span>
						{#if wallet.info.name === 'Burner Wallet'}
							<span class="text-xs text-amber-600 dark:text-amber-400">
								⚠️ Stored in clear text. Do not use with real funds.
							</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{:else}
		<!-- `cancel`, not `dismiss`: this is a Cancel BUTTON inside the flow, which
		     is a deliberate act. Only clicking away is second-guessed. -->
		<NoWalletFlow
			onCancel={() => connection.cancel()}
			secondary={hasOtherSignInOptions}
		/>
	{/if}

	{#if !hasOtherSignInOptions}
		<Button
			variant="outline"
			class="mt-3 w-full"
			onclick={() => connection.cancel()}
		>
			Cancel
		</Button>
	{/if}

	{#if dev && connection.targetStep == 'SignedIn' && !connection.walletOnly}
		<!-- Dev option -->
		<Button
			variant="ghost"
			class="mt-2 w-full text-xs text-muted-foreground"
			onclick={() =>
				connection.connect({
					type: 'mnemonic',
					mnemonic:
						'test test test test test test test test test test test junk',
					index: undefined,
				})}
		>
			Dev Mode
		</Button>
	{/if}
</Modal.Root>

<!-- Wallet picker (multi-wallet case): opened from the "Connect a Wallet" button. -->
<Modal.Root
	openWhen={walletPickerOpen &&
		($connection.step == 'WalletToChoose' ||
			$connection.step == 'MechanismToChoose')}
	onCancel={() => (walletPickerOpen = false)}
>
	<Modal.Title>
		{$connection.wallets.length} wallet{$connection.wallets.length > 1
			? 's'
			: ''} available, choose one
	</Modal.Title>
	<div class="flex flex-col gap-3 py-2">
		<div
			class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-md border border-input bg-muted/50 p-2"
		>
			{#each $connection.wallets as wallet}
				<button
					class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
					onclick={() => {
						walletPickerOpen = false;
						connection.connect({type: 'wallet', name: wallet.info.name});
					}}
				>
					<div class="h-6 w-6 shrink-0 overflow-hidden rounded-full">
						<img
							src={wallet.info.icon}
							alt={wallet.info.name}
							class="h-full w-full object-contain"
						/>
					</div>
					<div class="flex flex-col">
						<span class="text-sm font-medium">{wallet.info.name}</span>
						{#if wallet.info.name === 'Burner Wallet'}
							<span class="text-xs text-amber-600 dark:text-amber-400">
								⚠️ Stored in clear text. Do not use with real funds.
							</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>
		<Button
			variant="outline"
			class="w-full"
			onclick={() => (walletPickerOpen = false)}
		>
			Back
		</Button>
	</div>
</Modal.Root>

<!-- Confirm the connected account and sign in. For a single-account wallet this
     is the "confirm this account" step; for multi-account it follows the picker.
     Handles a live account swap: if the user changes their active account in
     the wallet UI, `signInAddress` reflects it and Sign In adopts it first. -->
<Modal.Root
	openWhen={connection.targetStep !== 'WalletConnected' &&
		$connection.step === 'WalletConnected' &&
		!signingInFromChooser}
	onCancel={dismissable ? dismiss : undefined}
>
	<Modal.Title>Confirm sign in</Modal.Title>
	<Modal.Description>
		Sign a message with this account to sign in. Accepting the message gives
		this app access to the account, so only accept on websites you trust.
	</Modal.Description>

	{#if signInAddress}
		<div
			class="my-4 flex items-center gap-3 rounded-md border border-input bg-muted/50 px-3 py-2.5"
		>
			<div
				class="h-8 w-8 shrink-0 overflow-hidden rounded-full *:h-full *:w-full"
			>
				<EthereumAvatar address={signInAddress} />
			</div>
			<div class="flex flex-col">
				<Address value={signInAddress} />
				{#if swappedAccount}
					<span class="text-xs text-muted-foreground">
						Using your currently selected account.
					</span>
				{/if}
			</div>
		</div>
	{/if}

	<Modal.Footer>
		<Button variant="outline" onclick={() => connection.cancel()}>Cancel</Button
		>
		<Button onclick={() => signInAdoptingSwap(connection)}>Sign In</Button>
	</Modal.Footer>
</Modal.Root>

<!-- Account choice (multi-account wallet). Two presentations:
     - sign-in target: a combined "choose + confirm sign in" modal, so picking
       an account and confirming it are ONE step instead of two back-to-back
       modals. Rows select (highlight); the Sign In button adopts the selected
       account and requests the signature in a single action.
     - wallet-only target: the plain picker, where clicking a row IS the final
       action (no signature follows). -->
<Modal.Root
	openWhen={$connection.step === 'ChooseWalletAccount'}
	onCancel={dismissable ? dismiss : undefined}
>
	{#if $connection.step == 'ChooseWalletAccount'}
		<!-- ASSERT ChooseWalletAccount -->
		{#if combinedChooseAndSignIn}
			<Modal.Title>Confirm sign in</Modal.Title>
			<Modal.Description>
				Choose an account and sign a message with it to sign in. Accepting the
				message gives this app access to the account, so only accept on websites
				you trust.
			</Modal.Description>
			<div class="flex flex-col gap-3 py-2">
				<div
					class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-md border border-input bg-muted/50 p-2"
				>
					{#each $connection.wallet.accounts as account}
						<button
							class="flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground {selectedAccount ===
							account
								? 'border-primary bg-accent/50'
								: 'border-transparent'}"
							disabled={signingInFromChooser}
							onclick={() => (chosenAccount = account)}
						>
							<div
								class="h-6 w-6 shrink-0 overflow-hidden rounded-full *:h-full *:w-full"
							>
								<EthereumAvatar address={account} />
							</div>
							<Address value={account} />
						</button>
					{/each}
				</div>

				<Modal.Footer>
					<Button
						variant="outline"
						disabled={signingInFromChooser}
						onclick={() => connection.cancel()}
					>
						Cancel
					</Button>
					<Button
						disabled={!selectedAccount || signingInFromChooser}
						onclick={chooseAndSignIn}
					>
						{signingInFromChooser ? 'Signing in...' : 'Sign In'}
					</Button>
				</Modal.Footer>
			</div>
		{:else}
			<Modal.Title>
				{$connection.wallet.accounts.length} account{$connection.wallet.accounts
					.length > 1
					? 's'
					: ''} available, choose one
			</Modal.Title>
			<div class="flex flex-col gap-3 py-2">
				<div
					class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-md border border-input bg-muted/50 p-2"
				>
					{#each $connection.wallet.accounts as account}
						<button
							class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
							onclick={() => connection.connectToAddress(account)}
						>
							<div
								class="h-6 w-6 shrink-0 overflow-hidden rounded-full *:h-full *:w-full"
							>
								<EthereumAvatar address={account} />
							</div>
							<Address value={account} />
						</button>
					{/each}
				</div>

				<Button
					variant="outline"
					class="w-full"
					onclick={() => connection.cancel()}
				>
					Cancel
				</Button>
			</div>
		{/if}
	{/if}
</Modal.Root>

<BasicModal
	openWhen={$connection.step === 'WaitingForSignature'}
	title="Please sign"
	onCancel={dismissable ? dismiss : undefined}
>
	<p>Please accept the signature request...</p>
</BasicModal>

<BasicModal
	title="Please wait..."
	openWhen={$connection.step === 'PopupLaunched'}
>
	{#if $connection.step === 'PopupLaunched'}
		<!-- ASSERT PopupLaunched -->
		{#if $connection.popupClosed}
			<p>Popup seems to be closed without giving response.</p>
			<Button class="btn btn-primary" onclick={() => connection.cancel()}
				>abort</Button
			>
		{:else}
			<p>please follow instruction...</p>
		{/if}
	{/if}
</BasicModal>

<!-- Pending Wallet Request Modal -->
<BasicModal title="Wallet Action Required" openWhen={pendingRequest}>
	<div class="flex flex-col items-center gap-4 py-4">
		<svg
			class="h-12 w-12 animate-pulse text-primary"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			stroke-width="1.5"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
			/>
		</svg>
		<p class="text-center text-sm text-muted-foreground">
			Please confirm the request in your wallet
		</p>
	</div>
</BasicModal>

<!-- Network Switch Modal -->
<Modal.Root
	openWhen={(connection.isTargetStepReached($connection) &&
		$connection.mechanism.type === 'wallet' &&
		$connection.wallet?.invalidChainId) ||
		false}
	onCancel={dismissable ? dismiss : undefined}
>
	<Modal.Title>Switch Network Required</Modal.Title>
	<Modal.Description>
		This app requires connection to a different network
	</Modal.Description>

	<div class="my-6 flex flex-col items-center gap-4">
		<!-- Network Switch Visual -->
		<div class="flex w-full items-center justify-center gap-3">
			<!-- Current Network -->
			<div class="flex flex-col items-center gap-2">
				<div
					class="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50 ring-2 ring-destructive/50"
				>
					<svg
						class="h-7 w-7 text-muted-foreground"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
						/>
					</svg>
				</div>
				<span class="text-xs text-muted-foreground">Current</span>
			</div>

			<!-- Arrow -->
			<div class="flex flex-col items-center">
				<svg
					class="h-6 w-6 text-primary {$connection.wallet?.switchingChain
						? 'animate-pulse'
						: ''}"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
					/>
				</svg>
			</div>

			<!-- Target Network -->
			<div class="flex flex-col items-center gap-2">
				<div
					class="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary"
				>
					<svg
						class="h-7 w-7 text-primary"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
						/>
					</svg>
				</div>
				<span class="text-xs font-medium text-primary"
					>{connection.chainInfo.name || `Chain ${connection.chainId}`}</span
				>
			</div>
		</div>

		<!-- Info Text -->
		<p class="text-center text-sm text-muted-foreground">
			Your wallet might prompt you to approve the network switch
		</p>
	</div>

	<Modal.Footer>
		<Button
			variant="outline"
			onclick={() => connection.cancel()}
			disabled={!!$connection.wallet?.switchingChain}
		>
			Cancel
		</Button>
		<Button
			onclick={() => connection.switchWalletChain()}
			disabled={!!$connection.wallet?.switchingChain}
		>
			{#if $connection.wallet?.switchingChain}
				<svg class="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="4"
					/>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					/>
				</svg>
				Switching...
			{:else}
				Switch Network
			{/if}
		</Button>
	</Modal.Footer>
</Modal.Root>
