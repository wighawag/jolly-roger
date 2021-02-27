<script lang="ts">
  import {Router, CurrentPage} from './lib/routing';
  import routes from './routes/_.routes';
  import NavBar from './components/navigation/NavBar.svelte';
  import Navigating from './lib/routing/curi/Navigating.svelte';
  import Loading from './components/Loading.svelte';
  import Notifications from './components/notification/Notifications.svelte';
  // import NoInstallPrompt from './components/NoInstallPrompt.svelte';
  import NewVersionNotification from './components/NewVersionNotification.svelte';
  import Install from './components/Install.svelte';
  import {onMount} from 'svelte';

  onMount(() => {
    document.body.classList.add('dark:bg-black');
    document.body.classList.add('bg-white');
  });
</script>

<Install />
<NewVersionNotification />
<Router
  {routes}
  globalQueryStrings={['subgraph', 'debug', 'log', 'trace', '_d_eruda']}>
  <Notifications />
  <NavBar
    links={[{name: 'index', title: 'Home'}, {name: 'demo', title: 'Demo'}]} />
  <CurrentPage>
    <Loading />
    Loading...
  </CurrentPage>
  <Navigating component={Loading} />
</Router>
