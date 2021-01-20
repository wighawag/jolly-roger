<script lang="ts">
  import {getResponse} from '@curi/svelte';
  const response = getResponse();
</script>

{#if $response}
  <svelte:component this={$response.body} />
{:else}
  <slot />
{/if}
