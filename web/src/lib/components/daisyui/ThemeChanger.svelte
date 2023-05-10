<script>
	// from https://github.com/saadeghi/daisyui/blob/41c8b5ba8ba2e7b484bd21b87e5185c577c07fe1/src/docs/src/components/ThemeChange.svelte
	import {onMount} from 'svelte';
	import {themes} from './themes';
	import {themeChange} from 'theme-change';
	onMount(() => {
		themeChange(false);
	});
	export let dropdownClasses = '';
	export let btnClasses = 'btn-ghost';
	export let contentClasses = 'mt-16';
</script>

<!-- svelte-ignore a11y-no-noninteractive-tabindex -->

<div title="Change Theme" class={`dropdown dropdown-end ${dropdownClasses}`}>
	<div tabindex="0" class={`btn gap-1 normal-case ${btnClasses}`}>
		<svg
			width="20"
			height="20"
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			class="inline-block h-5 w-5 stroke-current md:h-6 md:w-6"
			><path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
			/></svg
		>
		<span class="hidden md:inline">Change Theme</span>
		<svg
			width="12px"
			height="12px"
			class="ml-1 hidden h-3 w-3 fill-current opacity-60 sm:inline-block"
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 2048 2048"><path d="M1799 349l242 241-1017 1017L7 590l242-241 775 775 775-775z" /></svg
		>
	</div>
	<div
		class={`dropdown-content bg-base-200 text-base-content rounded-t-box rounded-b-box top-px max-h-96 h-[70vh] w-64 overflow-y-auto shadow-2xl ${contentClasses}`}
	>
		<div class="grid grid-cols-1 gap-3 p-3" tabindex="0">
			{#each themes as theme}
				<button
					class="outline-base-content overflow-hidden rounded-lg text-left"
					data-set-theme={theme.id}
					data-act-class="[&_svg]:visible"
					aria-label={theme.name}
				>
					<div data-theme={theme.id} class="bg-base-100 text-base-content w-full cursor-pointer font-sans">
						<div class="grid grid-cols-5 grid-rows-3">
							<div class="col-span-5 row-span-3 row-start-1 flex gap-2 py-3 px-4 items-center">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="currentColor"
									class="w-3 h-3 invisible"
									><path d="M20.285 2l-11.285 11.567-5.286-5.011-3.714 3.716 9 8.728 15-15.285z" /></svg
								>
								<div class="flex-grow text-sm font-bold">
									{theme.name}
								</div>
								<div class="flex flex-shrink-0 flex-wrap gap-1 h-full">
									<div class="bg-primary w-2 rounded" />
									<div class="bg-secondary w-2 rounded" />
									<div class="bg-accent w-2 rounded" />
									<div class="bg-neutral w-2 rounded" />
								</div>
							</div>
						</div>
					</div>
				</button>
			{/each}
		</div>
	</div>
</div>
