<script lang="ts">
  import {onDestroy, SvelteComponent} from 'svelte';
  import {getRouter} from '@curi/svelte';

  let router = getRouter();

  let canNavigate = (event: MouseEvent, target: Element) => {
    return (
      !event.defaultPrevented &&
      !target &&
      event.button === 0 &&
      !(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
    );
  };

  export let name: string;
  export let params = {};
  export let hash: string | undefined = undefined;
  export let query: string | undefined = undefined;
  export let state: any | null = null;
  export let wrapper: SvelteComponent;

  let navigating = false;

  $: url = router.url({name, params, hash, query});
  $: target = $$restProps.target;

  let cancelCallbacks: (() => void) | undefined;

  function handleClick(event: MouseEvent) {
    if (canNavigate(event, target)) {
      event.preventDefault();
      let cancelled, finished;
      cancelled = finished = () => {
        cancelCallbacks = undefined;
        navigating = false;
      };
      navigating = true;

      cancelCallbacks = router.navigate({
        url,
        state,
        cancelled,
        finished,
      });
    }
  }

  onDestroy(() => {
    if (cancelCallbacks) {
      cancelCallbacks();
    }
  });
</script>

<a {...$$restProps} href={url} on:click={handleClick}>
  <svelte:component this={wrapper} {navigating}>
    <slot />
  </svelte:component>
</a>
