<script lang="ts">
	import Notifications from '$lib/core/notifications/Notifications.svelte';
	import VersionAndInstallNotfications from '$lib/core/service-worker/VersionAndInstallNotfications.svelte';
	import {notifications, serviceWorker} from '$lib/core/config';
	import NavigationProgress from '$lib/components/NavigationProgress.svelte';
	import '../app.css';
	let {children} = $props();
</script>

<NavigationProgress />

{@render children()}

<Notifications {notifications} />

<VersionAndInstallNotfications {serviceWorker} />
