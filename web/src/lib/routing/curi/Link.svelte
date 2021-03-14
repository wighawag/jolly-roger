<script lang="ts">
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
  export let state: any = null;

  $: url = router.url({name, params, hash, query});
  $: target = $$restProps.target;

  function handleClick(event: MouseEvent) {
    if (canNavigate(event, target)) {
      event.preventDefault();
      router.navigate({url, state});
    }
  }
</script>

<a {...$$restProps} href={url} on:click={handleClick}>
  <slot />
</a>
