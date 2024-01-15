<script lang="ts">
	import {accountData} from '$lib/web3';
	import DebugWrapper from '../DebugWrapper.svelte';
	const actions = accountData.onchainActions;

	$: transactions = Object.keys($actions).map((v) => ({hash: v, transaction: ($actions as any)[v]}));
</script>

<DebugWrapper>
	<p slot="title">Transactions</p>
	<ul>
		{#each transactions as transaction}
			<li>{transaction.hash}: {transaction.transaction.inclusion}</li>
		{/each}
	</ul>
</DebugWrapper>

<style>
	ul {
		margin-left: 1rem;
	}
</style>
