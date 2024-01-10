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
		<a class="button primary" href={route('/demo/')} aria-label="Try the Demo!">Demo</a>
		<a
			class="button secondary"
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
	<div>
		<h2>Showcase</h2>
		<p>
			Here are examples of apps built using "{name}"
		</p>
	</div>
	<div>
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

	<div>
		<h2>Features</h2>
		<div>
			<div>
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
		.button {
			display: block;
			margin-bottom: 16px;
		}
	}

	.button {
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

	section > img {
		margin-inline: auto;
	}
</style>
