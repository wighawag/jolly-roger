<script lang="ts">
	import Notifications from '$lib/core/notifications/Notifications.svelte';
	import VersionAndInstallNotfications from '$lib/core/service-worker/VersionAndInstallNotfications.svelte';
	import NavigationProgress from '$lib/components/NavigationProgress.svelte';
	import {notifications, serviceWorker} from '$lib';
	import '../app.css';
	let {children} = $props();
</script>

<NavigationProgress />

{@render children()}

<Notifications {notifications} />

<VersionAndInstallNotfications {serviceWorker} />
