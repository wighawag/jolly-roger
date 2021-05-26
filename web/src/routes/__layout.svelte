<script lang="ts">
  import '../service-worker-handler';
  import '../global.css';
  import {url} from '$lib/utils/url';
  import NavBar from '$lib/components/navigation/NavBar.svelte';
  import Notifications from '$lib/components/notification/Notifications.svelte';
  import NoInstallPrompt from '$lib/components/NoInstallPrompt.svelte';
  import NewVersionNotification from '$lib/components/NewVersionNotification.svelte';
  // import Install from './components/Install.svelte';
  import DarkSwitch from '$lib/components/DarkSwitch.svelte';
</script>

<svelte:head>
  <title>Jolly Roger, Template for Decentralised Applications.</title>
</svelte:head>

<NoInstallPrompt />
<NewVersionNotification />

<NavBar
  links={[
    {href: url(''), title: 'Home'},
    {href: url('demo/'), title: 'Demo'},
  ]}
/>

<div class="absolute top-0 right-0 m-2">
  <DarkSwitch />
</div>

<slot />
<Notifications />
