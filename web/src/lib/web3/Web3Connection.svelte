<script lang="ts">
	import type {
		execution as Execution,
		network as Network,
		connection as Connection,
		pendingActions as PendingActions,
		account as Account,
	} from './';
	import Web3ConnectionError from './Web3ConnectionError.svelte';
	import Web3PendingActions from './Web3PendingActions.svelte';
	import Web3WalletSelection from './Web3WalletSelection.svelte';
	import Web3AccountInfo from './Web3AccountInfo.svelte';
	import Web3Executing from './Web3Executing.svelte';

	export let execution: typeof Execution;
	export let account: typeof Account;
	export let connection: typeof Connection;
	export let pendingActions: typeof PendingActions;
	export let network: typeof Network;
</script>

<Web3ConnectionError {connection} {network} />

<Web3WalletSelection {connection} />

<Web3PendingActions {pendingActions} />

<Web3Executing {network} {execution} {account} {connection} />

<Web3AccountInfo {account} />
