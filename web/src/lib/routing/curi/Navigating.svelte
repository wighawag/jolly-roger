<script lang="ts">
  import {onMount, onDestroy, SvelteComponent} from 'svelte';
  import {getRouter} from '@curi/svelte';

  let router = getRouter();

  type NavigationObserver = (cancel?: () => void) => void;

  let cancelCallback: NavigationObserver;
  let stop: () => void;

  export let component: unknown;

  onMount(() => {
    stop = router.cancel((fn: NavigationObserver) => {
      cancelCallback = fn;
    });
  });

  onDestroy(() => {
    if (stop) {
      stop();
    }
  });
</script>

{#if typeof cancelCallback === 'function'}
  <svelte:component this={component} cancel={cancelCallback} />
{/if}
