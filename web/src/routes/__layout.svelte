<script>
  import '../service-worker-handler';
  import '../global.css';
  import {base} from '$app/paths';
  import NavBar from '$lib/components/navigation/NavBar.svelte';
  import Notifications from '$lib/components/notification/Notifications.svelte';
  import NoInstallPrompt from '$lib/components/NoInstallPrompt.svelte';
  import NewVersionNotification from '$lib/components/NewVersionNotification.svelte';
  // import Install from './components/Install.svelte';
</script>

<svelte:head>
  <title>Jolly Roger, Template for Decentralised Applications.</title>
</svelte:head>

<NoInstallPrompt />
<NewVersionNotification />

<NavBar
  links={[{href: `${base}/`, title: 'Home'}, {href: `${base}/demo/`, title: 'Demo'}]} />
<slot />
<Notifications />
