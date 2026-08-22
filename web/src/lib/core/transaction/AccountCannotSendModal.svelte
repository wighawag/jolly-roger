<script lang="ts">
	import * as Modal from '$lib/core/ui/modal/index.js';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	// `import.meta.env.DEV` rather than SvelteKit's `dev`: it says the same thing,
	// comes from the bundler instead of the framework, and keeps this component
	// (which is core, and reusable) free of `$app/*`. See src/lib/kit/README.md.
	const dev = import.meta.env.DEV;
	import {getAppContext} from '$lib';

	const {accountCannotSend} = getAppContext();
</script>

<Modal.Root
	openWhen={$accountCannotSend}
	onCancel={() => accountCannotSend.dismiss()}
>
	<Modal.Title>
		<span class="flex items-center gap-2 text-destructive">
			<AlertTriangleIcon class="h-5 w-5" />
			Cannot send transaction
		</span>
	</Modal.Title>

	<div class="space-y-3 py-4 text-sm text-muted-foreground">
		<p>
			This account cannot send transactions directly. Email and social sign-ins
			do not come with a wallet to sign transactions.
		</p>
		<p>Please reconnect with a web3 wallet to continue.</p>
		{#if dev}
			<!-- Developer-facing hint, shown only in dev builds. There is no setting
			     that fixes this here: an account with no wallet has nothing to sign
			     with, and this template only ever sends from the account itself. -->
			<p
				class="flex items-start gap-2 rounded-md border border-input bg-muted/50 p-3 text-xs"
			>
				<WrenchIcon class="mt-0.5 h-4 w-4 shrink-0" />
				<span>
					Dev note: this template sends every transaction from the connected
					account, so an account without a wallet cannot transact at all. To
					support email and social sign-ins, send from the local signer derived
					at sign-in instead - see the signer variant of this template, which
					adds the executor, balance and funding flow that needs.
				</span>
			</p>
		{/if}
	</div>

	<Modal.Footer>
		<Button variant="outline" onclick={() => accountCannotSend.dismiss()}>
			Close
		</Button>
	</Modal.Footer>
</Modal.Root>
