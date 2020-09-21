<script lang="ts">
  type ComponentModule = {default: unknown};

  export let pages: {
    name: string;
    path: string;
    component?: any;
    asyncComponent?: () => Promise<ComponentModule>;
  }[];
  export let globalQueryStrings: string[] = undefined;
  import Router from './curi/Router.svelte';
  import {createRouter} from './utils/createrouter';
  const router = createRouter(pages, globalQueryStrings);
</script>

<Router {router}>
  <slot />
</Router>
