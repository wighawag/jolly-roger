<script lang="ts">
  import {Router, CurrentPage} from './lib/routing';
  import routes from './routes/_.routes';
  import NavBar from './components/navigation/NavBar.svelte';
  import Navigating from './lib/routing/curi/Navigating.svelte';
  import Loading from './components/Loading.svelte';
  import Notifications from './components/notification/Notifications.svelte';
</script>

<Router
  {routes}
  globalQueryStrings={['subgraph', 'debug', 'log', 'trace', '_d_eruda']}>
  <Notifications />
  <NavBar links={[{name: 'index', title: 'Home'}, 'demo', 'wallet']} />
  <!-- 'test1/test11', 'test1/test11/page', 'test2', 'test2/page', 'test3/page' -->
  <CurrentPage>
    <Loading />
    Loading...
  </CurrentPage>
  <Navigating component={Loading} />
</Router>
