<script>
  import names from '../stores/names';
  names.listen();
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
