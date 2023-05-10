<script lang="ts">
	import {onMount} from 'svelte';
	import {themeChange} from 'theme-change';
	onMount(async () => {
		themeChange(false);
	});

	// TODO allow to pass themes to switch: export let themes: [string, string];
</script>

<button id="theme-switcher" data-toggle-theme="dark,light" data-act-class="ACTIVECLASS" aria-label="Switch Theme">
	<svg class="w-8 h-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width={2}
			d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
		/>
	</svg>
	<svg class="w-8 h-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width={2}
			d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
		/>
	</svg>
</button>

<style>
	:global(html[data-theme='dark']) #theme-switcher > svg:first-of-type {
		display: none;
	}
	:global(html[data-theme='dark']) #theme-switcher > svg:last-of-type {
		display: inline-block;
	}
	:global(html[data-theme='light']) #theme-switcher > svg:last-of-type {
		display: none;
	}
	:global(html[data-theme='light']) #theme-switcher > svg:firt-of-type {
		display: inline-block;
	}
</style>
