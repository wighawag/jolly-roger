<script lang="ts">
  export let name: string;
  export let params: any = {};
  export let partial: boolean = false;

  import Link from '../../lib/routing/curi/Link.svelte';
  import {getRouter, getResponse} from '@curi/svelte';
  import {active as activeInteraction} from '@curi/interactions';

  let router = getRouter();
  let response = getResponse();

  let active: boolean;
  $: route = router.route(name);
  $: active =
    $response && activeInteraction(route, $response, {params, partial});
</script>

{#if active}
  <li class="-mb-px mr-1">
    <Link
      class="bg-white dark:bg-black inline-block border-l border-t border-r rounded-t py-2 px-4 border-pink-600
        text-pink-600 font-semibold"
      {name}
      {params}>
      <slot />
    </Link>
  </li>
{:else}
  <li class="-mb-px mr-1">
    <Link
      class="bg-white dark:bg-black inline-block py-2 px-4 border-pink-600 text-pink-600 font-semibold"
      {name}
      {params}>
      <slot />
    </Link>
  </li>
{/if}
