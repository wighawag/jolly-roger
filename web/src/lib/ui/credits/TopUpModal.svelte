<script lang="ts">
	import * as Modal from '$lib/core/ui/modal/index.js';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import {Spinner} from '$lib/shadcn/ui/spinner/index.js';
	import Address from '$lib/core/ui/ethereum/Address.svelte';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import CoinsIcon from '@lucide/svelte/icons/coins';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import {hasFaucet} from '$lib/core/ui/faucet/index.js';
	import {getAppContext} from '$lib';
	import {deployments} from '$lib/deployments-store';
	import {topUpActionLabel} from './credits-view';

	// Every decision below (which methods exist, which step, how much, what it
	// buys, whether this also authorises the browser) is made in
	// ./top-up-flow.ts, which the context holds one of. This renders the answer.
	const {topUp, errorDetails, credits} = getAppContext();
</script>

<!-- `dismiss`, not `cancel`: this fires on a click anywhere outside the dialog,
     and a wallet popup makes that click routine. See TopUpFlow.dismiss. -->
<!-- SYSTEM, because this is opened FROM the insufficient-funds modal, which is
     a system overlay, and it has to sit on top of the dialog whose button
     opened it.

     This is the bug that made `layer` a required prop. It named no layer, took
     the default (`'modal'`, one rank below `'system'`), and a layer is a
     stacking context - so it rendered UNDERNEATH the modal that opened it, and
     the user saw "Let this browser play for you" through the dialog covering it.
     AcrossPages declares this after the funds modal and said in a comment that
     the ordering was what put it on top; declaration order ranks modals within
     ONE layer and cannot reach across two, so it never did. Pinned by
     test/lib/core/ui/modal/top-up-over-funds.svelte.test.ts. -->
<Modal.Root
	layer="system"
	openWhen={$topUp.open}
	onCancel={() => topUp.dismiss()}
>
	<Modal.Title>
		<span class="flex items-center gap-2">
			{#if $topUp.registering}
				<KeyRoundIcon class="h-5 w-5" />
				Let this browser play for you
			{:else}
				<CoinsIcon class="h-5 w-5" />
				{topUpActionLabel(credits)}
			{/if}
		</span>
	</Modal.Title>

	<div class="space-y-4 py-4">
		{#if $topUp.phase === 'preparing'}
			<p class="flex items-center gap-2 text-muted-foreground">
				<Spinner class="h-4 w-4" />
				Working out how you can pay.
			</p>
		{:else if $topUp.phase === 'choosing'}
			{#if $topUp.registering}
				<p class="text-muted-foreground">
					This browser holds a key so the app can post your greetings without
					asking you to sign every time. One transaction authorises it and gives
					it the gas it needs.
				</p>
			{:else}
				<p class="text-muted-foreground">
					{#if credits}
						This adds credits to your in-app balance, so the app can keep making
						moves for you.
					{:else}
						This moves funds to your in-app balance, so the app can keep making
						moves for you.
					{/if}
				</p>
			{/if}

			<div class="flex flex-col gap-2" data-testid="payment-methods">
				<!-- Order is the order they are declared in ./payment-methods.ts, and
				     the first available one is the primary action: paying from the
				     account is one transaction and no second connection. -->
				{#each $topUp.methods as method, i (method.id)}
					<Button
						variant={i === 0 ? 'default' : 'outline'}
						class="h-auto w-full flex-col items-start gap-1 py-3 text-left whitespace-normal"
						disabled={!method.available}
						onclick={() => topUp.choose(method.id)}
						data-testid={`pay-with-${method.id}`}
					>
						<span class="font-medium">{method.label}</span>
						<span class="text-xs opacity-80">
							{method.available ? method.description : method.unavailableReason}
						</span>
					</Button>
				{/each}
			</div>
		{:else if $topUp.phase === 'unavailable'}
			<!-- A real, reachable state, not a bug: an account with no wallet, in a
			     browser with no wallet. Explained rather than hidden behind a
			     disabled button or a spinner that never ends. -->
			<p class="text-muted-foreground" data-testid="no-payment-method">
				{$topUp.explanation}
			</p>
		{:else if $topUp.phase === 're-authorise'}
			<!-- The credential that would have authorised this browser is missing or
			     spent. One remedy (sign in again, which is where credentials are
			     minted) and three different reasons, so the sentence comes from the
			     routing that decided it rather than from here. -->
			<p class="text-muted-foreground" data-testid="re-authorise">
				{$topUp.explanation}
			</p>
			<!-- SAID BEFORE THE BUTTON IS PRESSED, because it is the one thing here
			     that can leave the user worse off than they started: a new credential
			     is minted at sign-in, so signing in again means signing out first,
			     and a sign-in they abandon halfway leaves them signed out. -->
			<p class="text-sm text-muted-foreground">
				This signs you out first. If you stop halfway you will need to sign in
				again before you can carry on.
			</p>
		{:else if $topUp.phase === 'signing-in'}
			<p class="flex items-center gap-2 text-muted-foreground">
				<Spinner class="h-4 w-4" />
				Waiting for you to sign in again.
			</p>
		{:else if $topUp.phase === 'connecting'}
			<p class="flex items-center gap-2 text-muted-foreground">
				<Spinner class="h-4 w-4" />
				Choose the account to pay from.
			</p>
		{:else if $topUp.phase === 'claiming'}
			<p class="flex items-center gap-2 text-muted-foreground">
				<Spinner class="h-4 w-4" />
				Waiting for the funds to arrive.
			</p>
		{:else if $topUp.phase === 'failed'}
			<p class="text-muted-foreground">
				Nothing was charged. You can close this and try again.
			</p>
		{:else if $topUp.phase === 'switch-account'}
			<!-- Some wallets (Rabby) expose ONE account at a time, so the account the
			     app is connected as and the account the wallet will act as can drift
			     apart. Saying which one is needed, and which one it is on, is the
			     difference between an instruction and a guess. -->
			<p class="text-muted-foreground" data-testid="switch-account">
				{#if $topUp.switchReason === 'sign'}
					Your wallet needs to be on the account you signed in with to authorise
					this browser.
				{:else}
					Your wallet needs to be on the account that is paying.
				{/if}
			</p>
			<div class="space-y-2 rounded-lg bg-muted p-4">
				<div class="flex items-center justify-between">
					<span class="text-muted-foreground">Switch to:</span>
					{#if $topUp.switchTo}
						<Address value={$topUp.switchTo} size="xs" mono />
					{/if}
				</div>
				{#if $topUp.switchFrom}
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">Currently on:</span>
						<Address value={$topUp.switchFrom} size="xs" mono />
					</div>
				{/if}
			</div>
			<p class="text-sm text-muted-foreground">
				Switch account in your wallet, then continue. Nothing has been sent.
			</p>
		{:else if $topUp.phase === 'empty'}
			<p class="text-muted-foreground">
				The account you chose to pay from is empty, so there is nothing to
				transfer yet.
			</p>
			{#if $topUp.payer}
				<div class="rounded-lg bg-muted p-4">
					<span class="text-sm text-muted-foreground">Paying account</span>
					<Address value={$topUp.payer} size="xs" mono />
				</div>
			{/if}
			{#if !hasFaucet}
				<p class="text-sm text-muted-foreground">
					No faucet is configured, so this account has to be funded elsewhere
					before you can continue.
				</p>
			{/if}
		{:else}
			<p class="text-muted-foreground">
				{#if $topUp.registering}
					One transaction authorises this browser to post in your name, and
					sends it the gas it needs to do so.
					{#if $topUp.route === 'direct'}
						<!-- Why no signature is coming. Without this the collapse looks
						     like a missing step: the user chose to pay with a wallet,
						     expected to sign something, and was shown a transaction. -->
						You are paying from the account you signed in with, so sending it is all
						the authorisation needed and there is nothing to sign.
					{:else if $topUp.route === 'pre-signed'}
						Your account already authorised this browser when you signed in, so
						there is nothing to sign.
					{/if}
				{:else if credits}
					This adds credits to your in-app balance, so the app can keep making
					moves for you.
				{:else}
					This moves funds to your in-app balance, so the app can keep making
					moves for you.
				{/if}
			</p>

			{#if $topUp.registering && $topUp.route === 'live-signature'}
				<!-- IMMEDIATELY BEFORE THE WALLET OPENS, which is what the button
				     below does, so this is not a step of its own: a screen the user
				     reads and dismisses before reaching the one that acts just puts a
				     click between understanding and doing. Same shape and tone as the
				     sign-in modal (see core/connection/ConnectionFlow.svelte): what is
				     being signed, what it allows, what it does not, how to undo it. -->
				<div class="space-y-2" data-testid="delegation-consent">
					<p class="text-muted-foreground">
						{#if $topUp.silentSigner}
							<!-- The development burner signs from a key in this browser,
							     with no prompt at all. Promising one leaves the user
							     waiting for a window that never opens. -->
							This also signs a message saying that the key held by this browser may
							act for your account. Your development wallet signs it for you, so nothing
							will pop up.
						{:else}
							Your wallet will first ask you to sign a message. It says that the
							key held by this browser may act for your account.
						{/if}
					</p>
					<ul
						class="list-disc space-y-1 pl-5 text-sm text-muted-foreground marker:text-muted-foreground"
					>
						<li>It lets this browser post greetings in your name.</li>
						<li>It cannot move your funds, or anything else you own.</li>
						<li>You can withdraw it later from your account panel.</li>
					</ul>
					<p class="text-sm text-muted-foreground">
						Only sign this on websites you trust.
					</p>
				</div>
			{/if}

			{#if $topUp.fundsPending}
				<!-- The money is on chain; the WALLET may not know yet. Sending is safe
				     (nonce ordering takes care of it) but the wallet has to agree before
				     it will sign, and one that is behind shows the old balance and
				     refuses. Saying so beats the user staring at a wallet claiming they
				     have nothing while this modal insists they do. Worded for both
				     causes: a wallet lagging the chain, and an app configured to read
				     from its own node rather than through the wallet. -->
				<p
					class="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
					data-testid="funds-pending"
				>
					<AlertTriangleIcon class="mt-0.5 h-4 w-4 shrink-0" />
					<span>
						The funds have arrived, but your wallet may still be showing the
						older balance. If it says you cannot afford this, give it a few
						seconds and try again.
					</span>
				</p>
			{/if}

			<div class="space-y-2 rounded-lg bg-muted p-4">
				{#if $topUp.creditsText}
					<div class="flex justify-between">
						<span class="text-muted-foreground">You get:</span>
						<span class="font-mono">{$topUp.creditsText} credits</span>
					</div>
				{/if}
				<div class="flex justify-between">
					<span class="text-muted-foreground">Cost:</span>
					<span class="font-mono">
						{$topUp.valueText}
						{$deployments.chain.nativeCurrency.symbol}
					</span>
				</div>
				{#if $topUp.payer}
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">Paid by:</span>
						<Address value={$topUp.payer} size="xs" mono />
					</div>
				{/if}
			</div>
		{/if}

		{#if $topUp.error}
			<p class="flex items-start gap-2 text-sm text-destructive">
				<AlertTriangleIcon class="mt-0.5 h-4 w-4 shrink-0" />
				<span>{$topUp.error}</span>
				{#if $topUp.details}
					<button
						class="underline"
						onclick={() => errorDetails.show($topUp.details ?? '')}
					>
						Details
					</button>
				{/if}
			</p>
		{/if}
	</div>

	<Modal.Footer>
		<!-- EVERY phase offers a way out. A footer that renders nothing leaves a
		     modal with only its close cross, which is what the connecting step did
		     when a wallet failed to connect: a spinner, an error, and no way to
		     retry. -->
		{#if $topUp.phase === 'preparing' || $topUp.phase === 'connecting' || $topUp.phase === 'signing-in' || $topUp.phase === 'claiming'}
			{#if $topUp.error}
				<Button
					class="flex-1"
					onclick={() => topUp.start()}
					disabled={$topUp.busy}
				>
					Try again
				</Button>
			{/if}
			<Button variant="outline" onclick={() => topUp.cancel()}>Cancel</Button>
		{:else if $topUp.phase === 'choosing'}
			<Button variant="outline" class="w-full" onclick={() => topUp.cancel()}>
				Cancel
			</Button>
		{:else if $topUp.phase === 'unavailable'}
			<Button variant="outline" class="w-full" onclick={() => topUp.cancel()}>
				Close
			</Button>
		{:else if $topUp.phase === 're-authorise'}
			<!-- A user gesture, which is what makes it safe to open a popup from:
			     signing in may need one, and a browser blocks a popup that was not
			     asked for by a click. -->
			<Button
				class="flex-1"
				onclick={() => topUp.reauthorise()}
				disabled={$topUp.busy}
				data-testid="re-authorise-confirm"
			>
				Sign in again
			</Button>
			<Button variant="outline" onclick={() => topUp.cancel()}>Cancel</Button>
		{:else if $topUp.phase === 'empty'}
			{#if $topUp.claimed}
				<!-- The claim already returned, and it returns once its transaction is
				     in. So this re-READS rather than claiming again: claiming twice
				     would ask the faucet for money it has already sent. -->
				<Button
					class="flex-1"
					onclick={() => topUp.refresh()}
					disabled={$topUp.busy}
				>
					Continue
				</Button>
			{:else if hasFaucet}
				<Button
					class="flex-1"
					onclick={() => topUp.claim()}
					disabled={$topUp.busy}
				>
					Get funds from the faucet
				</Button>
			{/if}
			<Button variant="outline" onclick={() => topUp.back()}>Back</Button>
			<Button variant="outline" onclick={() => topUp.cancel()}>Cancel</Button>
		{:else if $topUp.phase === 'failed'}
			<Button variant="outline" class="w-full" onclick={() => topUp.cancel()}>
				Close
			</Button>
		{:else if $topUp.phase === 'switch-account'}
			<Button
				class="flex-1"
				onclick={() => topUp.retry()}
				disabled={$topUp.busy}
				data-testid="retry-after-switch"
			>
				I have switched
			</Button>
			<Button
				variant="outline"
				onclick={() => topUp.cancel()}
				disabled={$topUp.busy}
			>
				Cancel
			</Button>
		{:else if $topUp.phase === 'ready' || $topUp.phase === 'sending'}
			<Button
				class="flex-1"
				onclick={() => topUp.confirm()}
				disabled={$topUp.busy}
				data-testid="confirm-top-up"
			>
				{#if $topUp.busy}<Spinner class="h-4 w-4" />{/if}
				{$topUp.registering && $topUp.route === 'live-signature'
					? 'Sign and pay'
					: 'Continue'}
			</Button>
			<Button
				variant="outline"
				onclick={() => topUp.cancel()}
				disabled={$topUp.busy}
			>
				Cancel
			</Button>
		{/if}
	</Modal.Footer>
</Modal.Root>
