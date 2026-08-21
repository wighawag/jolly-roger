<script lang="ts">
	import {route} from '$lib';
	import {url} from '$lib/kit/paths';
	import Button from '$lib/shadcn/ui/button/button.svelte';
	import DefaultHead from '../lib/metadata/DefaultHead.svelte';
	import {name} from '../web-config.json';
	import {onMount} from 'svelte';

	const words = ['Idea', 'Game', 'App'];
	let currentWordIndex = $state(0);

	onMount(() => {
		const interval = setInterval(() => {
			currentWordIndex = (currentWordIndex + 1) % words.length;
		}, 2000);

		return () => clearInterval(interval);
	});
</script>

<DefaultHead />

<div class="container mx-auto max-w-6xl px-4 py-12">
	<!-- Hero Section -->
	<div class="mb-16 flex flex-col items-center text-center">
		<img
			src={url('/icon.svg')}
			alt={name}
			class="mb-8 h-48 w-48 drop-shadow-lg"
		/>
		<h1 class="mb-4 text-5xl font-bold tracking-tight text-primary md:text-6xl">
			{name}
		</h1>
		<p class="mb-6 text-xl text-muted-foreground">
			<span
				class="bg-linear-to-br from-blue-500 to-cyan-300 box-decoration-clone bg-clip-text text-transparent"
				>Build</span
			>
			and
			<span
				class="bg-linear-to-br from-red-500 to-yellow-500 box-decoration-clone bg-clip-text text-transparent"
				>Deploy</span
			>
			for
			<span
				class="bg-linear-to-br from-pink-500 to-violet-500 box-decoration-clone bg-clip-text text-transparent"
				>Eternity</span
			>.
		</p>
		<p class="mb-8 max-w-2xl text-lg font-semibold">
			Welcome to your <span
				class="bg-linear-to-br from-red-500 to-yellow-500 box-decoration-clone bg-clip-text text-transparent"
				>{words[currentWordIndex]}</span
			>!
		</p>

		<!-- Action Buttons -->
		<div class="mb-8 flex flex-wrap justify-center gap-4">
			<Button
				href={route('/demo/')}
				size="lg"
				class="min-w-40 bg-linear-to-r from-pink-600 via-pink-500 to-rose-500 font-semibold text-white shadow-lg transition-all duration-300 hover:from-pink-700 hover:via-pink-600 hover:to-rose-600 hover:shadow-xl"
				>Check The Demo</Button
			>
		</div>
	</div>
</div>
