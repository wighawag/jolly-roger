<script lang="ts">
	function beforeinstallprompt(event: Event) {
		event.preventDefault();
	}
</script>

<svelte:window on:beforeinstallprompt={beforeinstallprompt} />
