<script lang="ts">
  import Router from './curi/Router.svelte';
  import {router} from './utils/createroutes';
  const routeInfo: any = router; // any to Remove warning
</script>

<Router router={routeInfo}>
  <slot />
</Router>
