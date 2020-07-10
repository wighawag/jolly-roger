<script>
  import {getResponse} from '@curi/svelte';
  const response = getResponse();

  import Link from '@curi/svelte/components/Link.svelte';
</script>

<svelte:component this="{$response.body}" />

<p class="m-3 text-3xl"> Links:</p>
<Link name="Index" class="button bg-red-200 ~positive !normal">Home</Link>
<Link name="Wallet" class="button ~positive !normal">wallet</Link>
