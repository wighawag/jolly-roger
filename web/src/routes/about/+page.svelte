<script lang="ts">
	import CopyBlock from '$lib/components/utilities/CopyBlock.svelte';

	import {name} from 'web-config';
</script>

<section class="py-2 px-4 text-center">
	<div class="max-w-auto md:max-w-lg mx-auto">
		<p class="!text-2xl flex justify-center space-x-2 font-black my-8">
			{name} is a template for building decentralised applications.
		</p>
		<p class="!text-xl flex justify-center space-x-2 my-8">
			It can be used to quickly get a dev environment for hackathon or quick prototypes.
		</p>
		<p class="!text-xl flex justify-center space-x-2 my-8">
			But it is also a good starting point for long term projects as it contains a set of best practises for web and
			ipfs deployment.
		</p>
		<p class="!text-xl flex justify-center space-x-2 my-8">
			{name} with its in-browser indexer, is also a great ally to ensure your application remains fully decentralised.
		</p>
	</div>

	<div class="pt-3 pb-4">
		<h1 class="m-4 font-semibold">Use it:</h1>
		<CopyBlock
			boxClass="p-2 rounded-box font-black text-primary max-w-xl mx-auto"
			class="mb-5"
			background="bg-reverse-primary"
			copiedBackground="bg-success"
			copiedColor="text-success-content"
			text={`npx degit wighawag/jolly-roger your-app-folder`}
		/>
		<p class="mt-6 text-base-300">
			Find out more on
			<a class="underline" href="https://github.com/wighawag/jolly-roger#readme" target="_blank" rel="noreferrer"
				>github</a
			>
		</p>
	</div>
</section>
