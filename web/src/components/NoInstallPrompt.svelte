<script lang="ts">
  import { onMount } from 'svelte';
  function beforeinstallprompt(event: Event) {
    event.preventDefault();
  }
  onMount(() => {
    window.addEventListener('beforeinstallprompt', beforeinstallprompt);
  });
</script>

<!-- this fails typing, so instead we use onMount-->
<!-- <svelte:window on:beforeinstallprompt={beforeinstallprompt} /> -->
