<script lang="ts">
	import Notifications from '$lib/core/notifications/Notifications.svelte';
	import NotificationOverlay from '$lib/core/notifications/NotificationOverlay.svelte';
	import VersionAndInstallNotfications from '$lib/core/service-worker/VersionAndInstallNotfications.svelte';
	import NavigationProgress from '$lib/components/NavigationProgress.svelte';
	import {notifications, serviceWorker} from '$lib';
	import {navigating} from '$app/state';
	import {ModeWatcher} from 'mode-watcher';
	import '../app.css';
	let {children} = $props();
</script>

<!--
	The mode lives on <html>, where app.html already paints the page black.
	Without a watcher nothing sets it, so the shadcn tokens stay light (a
	white body on a black page), dialogs and toasts portalled to <body> come
	out white, and the sonner wrapper's `mode.current` still writes the
	SYSTEM preference into `color-scheme`, which gives a light phone light
	native scrollbars over a dark page. Dark by default, to match app.html; a
	descendant offering a light theme passes another `defaultMode`.
-->
<ModeWatcher defaultMode="dark" />

<NavigationProgress isNavigating={() => !!navigating.to} />

{@render children()}

<NotificationOverlay>
	<Notifications {notifications} />
</NotificationOverlay>

<VersionAndInstallNotfications {serviceWorker} />
