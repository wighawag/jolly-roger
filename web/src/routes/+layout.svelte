<script lang="ts">
	import Notifications from '$lib/core/notifications/Notifications.svelte';
	import NotificationOverlay from '$lib/core/notifications/NotificationOverlay.svelte';
	import VersionAndInstallNotfications from '$lib/core/service-worker/VersionAndInstallNotfications.svelte';
	import {notifications, serviceWorker} from '$lib/core/config';
	import NavigationProgress from '$lib/components/NavigationProgress.svelte';
	import '../app.css';
	let {children} = $props();
</script>

<NavigationProgress />

{@render children()}

<NotificationOverlay>
	<Notifications {notifications} />
</NotificationOverlay>

<VersionAndInstallNotfications {serviceWorker} />
