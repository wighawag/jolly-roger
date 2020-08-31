<script lang="ts">
  import Router from './_routing/router.svelte';
  import CurrentPage from './_routing/currentpage.svelte';
  import Link from './_routing/curi/Link.svelte';
</script>

<Router>
  <CurrentPage />
  <Link name="Home">Home</Link>
  <Link name="Wallet">wallet</Link>
</Router>
