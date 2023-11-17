<script lang="ts">
	import {name} from 'web-config';
	import {route, url} from '$lib/utils/path';
	import Feature from '$lib/components/jolly-roger/Feature.svelte';
	import Showcase from '$lib/components/jolly-roger/Showcase.svelte';
	import CopyBlock from '$lib/components/utilities/CopyBlock.svelte';
</script>

<section class="py-2 px-4 text-center">
	<div class="max-w-auto md:max-w-lg mx-auto">
		<img
			class="mb-1 mx-auto"
			src={url('/icon.svg')}
			alt={name}
			style="width:256px;height:256px;"
			width="256px"
			height="256px"
		/>
		<h2
			class="mb-2 text-title font-black bg-gradient-to-br from-pink-600 via-pink-600 to-purple-600 bg-clip-text text-transparent box-decoration-clone"
		>
			{name}
		</h2>
		<div class="!text-xl flex justify-center space-x-2">
			<h3>
				<span class="bg-gradient-to-br from-blue-500 to-cyan-300 bg-clip-text text-transparent box-decoration-clone"
					>Build</span
				>
			</h3>
			<h3>and</h3>
			<h3>
				<span class="bg-gradient-to-br from-red-500 to-yellow-500 bg-clip-text text-transparent box-decoration-clone"
					>Deploy</span
				>
			</h3>
			<h3>for</h3>
			<h3>
				<span class="bg-gradient-to-br from-pink-500 to-violet-500 bg-clip-text text-transparent box-decoration-clone"
					>Eternity.</span
				>
			</h3>
		</div>
		<p class="y-6 m-6 !text-xl font-black">Production-Ready Template To Build Decentralised Applications</p>
		<div class="max-w-md mx-auto pt-1 mt-5 space-y-3 md:m-8 md:space-y-5">
			<div class="space-y-5 sm:flex sm:justify-center sm:space-y-0 sm:space-x-3">
				<a class="btn btn-primary btn-wide" href={route('/demo/')} aria-label="Try the Demo!">Demo</a>
				<a
					class="btn btn-secondary btn-wide"
					target="_blank"
					rel="noreferrer"
					href="https://github.com/wighawag/jolly-roger"
					aria-label="Check it out on github!"
				>
					Github
				</a>
			</div>
		</div>

		<div class="pt-3 pb-4">
			<h1 class="m-4 font-semibold">Use it:</h1>
			<CopyBlock
				boxClass="p-2 rounded-box font-black text-primary"
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
	</div>

	<div class="pt-16 relative max-w-7xl mx-auto">
		<div class="text-center">
			<h2 class="text-3xl tracking-tight font-extrabold sm:text-4xl">Showcase</h2>
			<p class="mt-3 max-w-2xl mx-auto text-xl sm:mt-4">
				Here are examples of apps built using "{name}"
			</p>
		</div>
		<div class="mt-12 max-w-lg mx-auto grid gap-5 lg:grid-cols-3 lg:max-w-none">
			<Showcase
				href="https://bleeps.art"
				preview="/images/featured/bleeps-preview-small.webp"
				name="bleeps.art"
				title="The Bleeps DAO and Its Fully Onchain Sounds"
				description="The First Composable Sounds Fully Generated On-Chain With Zero Externalities, no backend, no ipfs, no client-code, and a melody minter where some of the proceeds goes to the Bleeps DAO and its members"
				source="https://github.com/wighawag/bleeps"
			/>

			<Showcase
				href="https://mandalas.eth.limo"
				preview="/images/featured/mandalas-preview-small.webp"
				name="mandalas.eth"
				title="On-chain Generative Bitmaps With Zero Externalities"
				description="The First On-Chain Generative Art Project to make full use of token URI to remove all external dependencies. It generates SVG and Bitmap from the smart contract directly."
				source="https://github.com/wighawag/mandalas"
			/>

			<Showcase
				href="https://conquest.eth.limo"
				preview="/images/featured/conquest-preview-small.webp"
				name="conquest.eth"
				title="A Game of Strategy and Diplomacy Running on the EVM"
				description="An unstoppable game of strategy and diplomacy running on the EVM. It allows player to collaborate through on-chain alliances while remaining sovereign. A first of its kind."
			/>
		</div>

		<div class="pt-16 pb-4">
			<h2 class="text-3xl tracking-tight font-extrabold sm:text-4xl">Features</h2>
			<div class="max-w-xl mx-auto px-4 sm:px-6 lg:max-w-screen-xl lg:px-8">
				<div class="lg:grid lg:grid-cols-3 lg:gap-8">
					<Feature title="All Included">
						This template include setup for smart contracts, indexer and frontend. All runs locally for the
						best-in-class developer experience.
					</Feature>
					<Feature title="PWA ready: 100% Lighthouse score">
						The web app is fully PWA compliant, with offline caching, etc... The javascript code necessary to launch the
						app is less than 50kB (15kB compressed), including the home page content. Achieves 100% score on a barebone
						page without extra themes
					</Feature>
					<Feature title="Great Dev experience">
						<a class="link" href="https://github.com/NomicFoundation/hardhat/#readme" target="_blank" rel="noreferrer"
							>Hardhat</a
						>
						for contracts,
						<a class="link" href="https://github.com/wighawag/hardhat-deploy" target="_blank" rel="noreferrer"
							>hardhat-deploy</a
						>
						for contract deployment, the in-browser
						<a class="link" href="http://npmjs.com/package/ethereum-indexer" target="_blank" rel="noreferrer"
							>ethereum-indexer</a
						>
						for contract's api,
						<a class="link" href="https://svelte.dev" target="_blank" rel="noreferrer">svelte + Svelte Kit</a>
						for frontend with HMR (Hot Module Replacement) and production build.
					</Feature>
					<Feature title="Everything Hot Reload">
						On contract changes, contract get to keep their address and code get updated automatically. On frontend
						changes, module get replaced using blazing fast
						<a class="link" href="https://vite.dev" target="_blank" rel="noreferrer">Vite</a>
						es module hot reload.
					</Feature>
					<Feature title="Fully IPFS Ready">
						Fully IPFS ready with proper url routing. The web app works on both IPFS urls and ENS/DNS urls. PWA works on
						IPFS too with scoped service workers.
					</Feature>
					<Feature title="All in Typescript">The whole app including indexer and, is written in typescript.</Feature>
					<Feature title="Code Splitting and Tree Shaking">
						By using Svelte Kit (and so Vite) and ES modules, the frontend benefit from code splitting an dynamic
						imports as well as tree shaking.
					</Feature>
					<Feature title="VSCode Setup">
						The repo is setup as a vscode workspace with recommended plugins. Execute tests from the editor. Auto
						format, etc...
					</Feature>
					<Feature title="One command deploy">
						Everything is setup, except for the private ENV variable to deploy the contracts.
					</Feature>
				</div>
			</div>
		</div>
	</div>
</section>
