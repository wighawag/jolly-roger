<script lang="ts">
  import names from '../stores/names';
  names.listen();

  import CommonLib from 'common-lib';

  import {logs} from 'named-logs';
  const console = logs('app:home');
  console.log('CommonLib', CommonLib);
</script>

{#if !$names.status}
  <div>Name not loaded</div>
{:else if $names.status === 'Error'}
  <div>Error</div>
{:else if $names.status === 'Loading'}
  <div>Loading Names...</div>
{:else}
  {#each $names.data as name, index}
    <li>{name.id} : {name.name}</li>
  {/each}
{/if}

<h1>Hello world</h1>
