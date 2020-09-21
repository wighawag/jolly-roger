<script lang="ts">
  import {onMount, onDestroy} from 'svelte';
  import {getRouter} from '@curi/svelte';

  let router = getRouter();

  let cancelCallback;
  let stop;

  export let component;

  onMount(() => {
    stop = router.cancel((fn) => {
      cancelCallback = fn;
    });
  });

  onDestroy(() => {
    if (stop) {
      stop();
    }
  });
</script>

{#if typeof cancelCallback === "function"}
<svelte:component this={component} cancel={cancelCallback} />
{/if}
