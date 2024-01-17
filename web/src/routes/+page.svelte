<script lang="ts">
	import {name} from 'web-config';
	import {route, url} from '$lib/utils/path';
	import Feature from '$lib/components/jolly-roger/Feature.svelte';
	import Showcase from '$lib/components/jolly-roger/Showcase.svelte';
	import CopyBlock from '$lib/components/utilities/CopyBlock.svelte';
</script>

<section class="top">
	<img src={url('/icon.svg')} alt={name} style="width:256px;height:256px;" width="256px" height="256px" />
	<h1 class="text-gradient">
		{name}
	</h1>
	<h2 class="text-build-deploy-eternity">
		<span class="text-gradient text-build">Build</span>
		<span>and</span>
		<span class="text-gradient text-deploy">Deploy</span>
		<span>for</span>
		<span class="text-gradient text-eternity">Eternity.</span>
	</h2>
	<p class="description">Production-Ready Template To Build Decentralised Applications</p>
	<div class="actions">
		<a role="button" class="primary" href={route('/demo/')} aria-label="Try the Demo!">Demo</a>
		<a
			role="button"
			class="secondary"
			target="_blank"
			rel="noreferrer"
			href="https://github.com/wighawag/jolly-roger"
			aria-label="Check it out on github!"
		>
			Github
		</a>
	</div>

	<div class="use">
		<h2>Use it:</h2>
		<CopyBlock text={`npx degit wighawag/jolly-roger your-app-folder`} />
		<p>
			Find out more on
			<a href="https://github.com/wighawag/jolly-roger#readme" target="_blank" rel="noreferrer">github</a>
		</p>
	</div>
</section>

<section class="bottom">
	<div class="bottom-header">
		<h2 class="bottom-header-title">Showcase</h2>
		<p class="bottom-header-description">
			Here are examples of apps built using "{name}"
		</p>
	</div>
	<div class="showcase-list">
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

	<div class="features-wrapper">
		<h2>Features</h2>
		<div class="features-list-wrapper">
			<div class="features-list">
				<Feature title="All Included">
					This template include setup for smart contracts, indexer and frontend. All runs locally for the best-in-class
					developer experience.
				</Feature>
				<Feature title="PWA ready: 100% Lighthouse score">
					The web app is fully PWA compliant, with offline caching, etc... The javascript code necessary to launch the
					app is less than 50kB (15kB compressed), including the home page content. Achieves 100% score on a barebone
					page without extra themes
				</Feature>
				<Feature title="Great Dev experience">
					<a href="https://github.com/NomicFoundation/hardhat/#readme" target="_blank" rel="noreferrer">Hardhat</a>
					for contracts,
					<a href="https://github.com/wighawag/hardhat-deploy" target="_blank" rel="noreferrer">hardhat-deploy</a>
					for contract deployment, the in-browser
					<a href="http://npmjs.com/package/ethereum-indexer" target="_blank" rel="noreferrer">ethereum-indexer</a>
					for contract's api,
					<a href="https://svelte.dev" target="_blank" rel="noreferrer">svelte + Svelte Kit</a>
					for frontend with HMR (Hot Module Replacement) and production build.
				</Feature>
				<Feature title="Everything Hot Reload">
					On contract changes, contract get to keep their address and code get updated automatically. On frontend
					changes, module get replaced using blazing fast
					<a href="https://vite.dev" target="_blank" rel="noreferrer">Vite</a>
					es module hot reload.
				</Feature>
				<Feature title="Fully IPFS Ready">
					Fully IPFS ready with proper url routing. The web app works on both IPFS urls and ENS/DNS urls. PWA works on
					IPFS too with scoped service workers.
				</Feature>
				<Feature title="All in Typescript">The whole app including indexer and, is written in typescript.</Feature>
				<Feature title="Code Splitting and Tree Shaking">
					By using Svelte Kit (and so Vite) and ES modules, the frontend benefit from code splitting an dynamic imports
					as well as tree shaking.
				</Feature>
				<Feature title="VSCode Setup">
					The repo is setup as a vscode workspace with recommended plugins. Execute tests from the editor. Auto format,
					etc...
				</Feature>
				<Feature title="One command deploy">
					Everything is setup, except for the private ENV variable to deploy the contracts.
				</Feature>
			</div>
		</div>
	</div>
</section>

<style>
	/* Structure */
	section {
		text-align: center;
		margin-inline: auto;
		max-width: 600px;
		padding-inline: 16px;
	}

	section.bottom {
		max-width: 1280px;
	}

	.bottom-header {
		text-align: center;
	}

	.bottom-header-title {
		font-size: 1.875rem;
		line-height: 2.25rem;
		font-weight: 800;
		letter-spacing: -0.025em;
	}

	@media (min-width: 640px) {
		.bottom-header-title {
			font-size: 2.25rem;
			line-height: 2.5rem;
		}
	}

	.bottom-header-description {
		margin-top: 0.75rem;
		max-width: 42rem;
		font-size: 1.25rem;
		line-height: 1.75rem;
		margin-inline: auto;
	}

	@media (min-width: 640px) {
		.bottom-header-description {
			margin-top: 1rem;
		}
	}

	.showcase-list {
		display: grid;
		margin-top: 3rem;
		gap: 1.25rem;
		max-width: 32rem;
		margin-inline: auto;
	}

	@media (min-width: 1024px) {
		.showcase-list {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			max-width: none;
		}
	}

	.features-wrapper {
		padding-bottom: 1rem;
		padding-top: 4rem;
	}

	.features-wrapper > h2 {
		font-size: 1.875rem;
		line-height: 2.25rem;
		font-weight: 800;
		letter-spacing: -0.025em;
	}

	@media (min-width: 640px) {
		.features-wrapper > h2 {
			font-size: 2.25rem;
			line-height: 2.5rem;
		}
	}

	.features-list-wrapper {
		padding-left: 1rem;
		padding-right: 1rem;
		max-width: 36rem;
		margin-inline: auto;
	}

	@media (min-width: 640px) {
		.features-list-wrapper {
			padding-left: 1.5rem;
			padding-right: 1.5rem;
		}
	}

	@media (min-width: 1024px) {
		.features-list-wrapper {
			padding-left: 2rem;
			padding-right: 2rem;
			max-width: 1280px;
		}
	}

	@media (min-width: 1024px) {
		.features-list {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 2rem;
		}
	}

	section > img {
		margin-inline: auto;
	}

	/* Style */
	.text-gradient {
		background-clip: text;
		color: rgba(0, 0, 0, 0);
		background-image: linear-gradient(to right bottom, rgb(219, 39, 119), rgb(219, 39, 119), rgb(147, 51, 234));
	}

	h1 {
		margin-top: 4px;
		margin-bottom: 32px;
		font-size: 3.75rem;
		background-image: linear-gradient(to right bottom, rgb(219, 39, 119), rgb(219, 39, 119), rgb(147, 51, 234));
	}

	p,
	h2 {
		margin-block: 24px;
	}
	.text-build-deploy-eternity {
		font-size: x-large;
	}
	.text-build {
		background-image: linear-gradient(to right bottom, rgb(59, 130, 246), rgb(103, 232, 249));
	}
	.text-deploy {
		background-image: linear-gradient(to right bottom, rgb(239, 68, 68), rgb(234, 179, 8));
	}
	.text-eternity {
		background-image: linear-gradient(to right bottom, rgb(236, 72, 153), rgb(139, 92, 246));
	}

	.description {
		font-size: x-large;
		font-weight: bold;
	}

	.actions {
		display: flex;
		justify-content: space-around;
		/* gap: 16px; */
	}
	@media (max-width: 600px) {
		.actions {
			display: initial;
		}
		a[role='button'] {
			display: block;
			margin-bottom: 16px;
		}
	}

	a[role='button'] {
		padding: 10px;
		padding-inline: 64px;
		text-decoration: none;
		font-weight: bold;

		border-radius: 10px;

		height: 3rem;
		min-height: 3rem;
	}

	.use h2 {
		margin-top: 48px;
		font-size: medium;
	}
</style>
