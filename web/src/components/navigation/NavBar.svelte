<script lang="ts">
  type LinkInfo = string | {name: string; title: string};
  export let links: LinkInfo[];
  import NavLink from './NavLink.svelte';
</script>

<ul class="flex m-1 border-b border-pink-600">
  {#each links as link}
    <NavLink name={typeof link === 'string' ? link : link.name}>
      {typeof link === 'string' ? link : link.title}
    </NavLink>
  {/each}
</ul>
