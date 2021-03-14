<script lang="ts">
  type ComponentModule = {default: unknown};

  export let routes: {
    name: string;
    path: string;
    component?: any;
    asyncComponent?: () => Promise<ComponentModule>;
  }[];
  export let globalQueryStrings: string[] = [];
  import Router from './curi/Router.svelte';
  import {createRouter} from './utils/createrouter';
  const router = createRouter(routes, globalQueryStrings);
</script>

<Router {router}>
  <slot />
</Router>
