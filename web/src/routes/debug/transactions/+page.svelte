<script lang="ts">
	import {accountData} from '$lib/web3';
	const actions = accountData.onchainActions;

	$: transactions = Object.keys($actions).map((v) => ({hash: v, transaction: ($actions as any)[v]}));
</script>

<ul>
	{#each transactions as transaction}
		<li>{transaction.hash}: {transaction.transaction.inclusion}</li>
	{/each}
</ul>
