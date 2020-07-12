<script>
  import names from '../stores/names';
  names.listen();

  import Link from '@curi/svelte/components/Link.svelte';
</script>

{#if !$names.status}
<div>Name not loaded</div>
{:else if $names.status === 'Error'}
<div>Error</div>
{:else if $names.status === 'Loading'}
<div>Loading Names...</div>
{:else} {#each $names.data as name, index}
<li>{name.name}</li>
{/each} {/if}


<p class="m-3 text-3xl"> Links:</p>
<Link name="Index" class="button bg-red-200 ~positive !normal">Home</Link>
<Link name="Wallet" class="button ~positive !normal">wallet</Link>

