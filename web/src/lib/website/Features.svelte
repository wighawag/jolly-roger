<script lang="ts">
	import RocketIcon from '@lucide/svelte/icons/rocket';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import CodeIcon from '@lucide/svelte/icons/code';
	import SplitIcon from '@lucide/svelte/icons/split';
	import PackageCheckIcon from '@lucide/svelte/icons/package-check';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import CompassIcon from '@lucide/svelte/icons/compass';

	const features = [
		{
			title: 'All Included',
			description:
				'This template includes setup for smart contracts and frontend. All runs locally for the best-in-class developer experience.',
			icon: LayersIcon,
		},
		{
			title: 'PWA Ready',
			description:
				'The web app is a fully-configured PWA with offline caching and service worker support.',
			icon: RocketIcon,
		},
		{
			title: 'Great Dev Experience',
			description:
				'Hardhat v3 + hardhat-deploy v2 + rocketh for contracts; SvelteKit 5 + Vite for the frontend, with HMR.',
			icon: ZapIcon,
		},
		{
			title: 'Everything Hot Reload',
			description:
				'On contract changes, contracts keep their address and code get updated automatically. On frontend changes, module get replaced using blazing fast Vite es module hot reload.',
			icon: RefreshCwIcon,
		},
		{
			title: 'Built-in Explorer & Contract Interaction',
			description:
				'An in-browser explorer for addresses and transactions, plus a UI to interact directly with your deployed contracts.',
			icon: CompassIcon,
		},
		{
			title: 'Fully IPFS Ready',
			description:
				'Fully IPFS ready with proper url routing. The web app works on both IPFS urls and ENS/DNS urls. PWA works on IPFS too with scoped service workers.',
			icon: GlobeIcon,
		},
		{
			title: 'All in Typescript',
			description:
				'The whole app, including the contract tooling and frontend, is written in TypeScript.',
			icon: CodeIcon,
		},
		{
			title: 'Code Splitting and Tree Shaking',
			description:
				'By using SvelteKit (and so Vite) and ES modules, the frontend benefits from code splitting, dynamic imports, and tree shaking.',
			icon: SplitIcon,
		},
		{
			title: 'Works Out of the Box',
			description:
				'No editor-specific setup required. Clone, install, and everything runs: contracts and frontend, with tests, formatting and hot reload ready to go.',
			icon: PackageCheckIcon,
		},
		{
			title: 'One command deploy',
			description:
				'Everything is set up, except for the private ENV variable to deploy the contracts.',
			icon: TerminalIcon,
		},
	];
</script>

<!-- Features Section -->
<section class="mb-16">
	<h2 class="mb-8 text-center text-3xl font-bold">Features</h2>

	<div class="grid gap-6 lg:grid-cols-3">
		{#each features as feature}
			<div
				class="mx-auto w-full max-w-125 rounded-lg border bg-card p-6 shadow-sm lg:mx-0 lg:max-w-none"
			>
				<div
					class="mb-4 flex items-center justify-center gap-3 lg:justify-start"
				>
					<feature.icon class="h-6 w-6 text-primary" />
					<h3 class="text-lg font-semibold text-primary">{feature.title}</h3>
				</div>
				<p class="text-sm text-muted-foreground">{feature.description}</p>
			</div>
		{/each}
	</div>
</section>
