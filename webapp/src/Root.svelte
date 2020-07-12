<script>
  import {getResponse} from '@curi/svelte';
  const response = getResponse();
</script>

<svelte:component this="{$response.body}" />
