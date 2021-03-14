<script lang="ts">
  import type {CuriRouter} from '@curi/types';
  import {setup} from '@curi/svelte';

  export let router: CuriRouter;

  setup(router);
</script>

<slot />
