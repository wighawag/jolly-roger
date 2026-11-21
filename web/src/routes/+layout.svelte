<script lang="ts">
	import Notifications from '$lib/core/notifications/Notifications.svelte';
	import VersionAndInstallNotfications from '$lib/core/service-worker/VersionAndInstallNotfications.svelte';
	import NavigationProgress from '$lib/components/NavigationProgress.svelte';
	import {notifications, serviceWorker} from '$lib';
	import {navigating} from '$app/state';
	import '../app.css';
	let {children} = $props();
</script>

<NavigationProgress isNavigating={() => !!navigating.to} />

{@render children()}

<!-- The update notice before the notifications, so a notification paints over
     it where they meet: what the user has to act on beats a reload that can
     wait. -->
<VersionAndInstallNotfications {serviceWorker} />

<Notifications {notifications} />
