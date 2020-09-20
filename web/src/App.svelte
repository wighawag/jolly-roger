<script lang="ts">
  import Router from './_routing/router.svelte';
  import CurrentPage from './_routing/currentpage.svelte';
  import Navbar from './components/Navbar.svelte';
</script>

<Router>
  <Navbar links={['Home', 'Demo', 'Wallet']} />
  <CurrentPage />
</Router>
