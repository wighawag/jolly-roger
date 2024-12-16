<script lang="ts">
	import { onMount } from "svelte";

	function beforeinstallprompt(event: Event) {
		event.preventDefault();
	}

	onMount(() => {
		window.addEventListener('beforeinstallprompt', beforeinstallprompt)
		return () => {
			window.removeEventListener('beforeinstallprompt', beforeinstallprompt)
		}
	})
</script>

