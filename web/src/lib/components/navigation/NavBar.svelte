<script lang="ts">
  type LinkInfo = {href: string; title: string};
  export let links: LinkInfo[];
  import NavLink from './NavLink.svelte';
  import Loading from '../Loading.svelte';
  import {base} from '$app/paths';
  import {page, navigating} from '$app/stores';
</script>

<!-- {JSON.stringify($page, null, '  ')} -->

<!-- {JSON.stringify($navigating, null, '  ')} -->

<ul class="flex m-1 border-b border-pink-600">
  {#each links as link}
    <NavLink
      href={link.href}
      active={link.href.replace(base, '').replace(/^\/+|\/+$/g, '') === $page.path.replace(/^\/+|\/+$/g, '')}
    >
      {link.title}
      <!-- ({link.href}) -->
    </NavLink>
  {/each}
</ul>

{#if $navigating}
  <Loading />
{/if}
