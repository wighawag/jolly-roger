<script lang="ts">
	import DefaultHead from '../../lib/metadata/DefaultHead.svelte';
	import {Button} from '$lib/shadcn/ui/button';
	import {CopyCommand} from '$lib/core/ui/copy-command';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import CodeIcon from '@lucide/svelte/icons/code';
	import UsersIcon from '@lucide/svelte/icons/users';
	import TwitterIcon from '$lib/icons/TwitterIcon.svelte';
	import GithubIcon from '$lib/icons/GithubIcon.svelte';
</script>

<DefaultHead title={'About - Jolly Roger'} />

<div class="container mx-auto max-w-4xl px-4 py-12">
	<!-- Hero Section -->
	<div class="mb-12 text-center">
		<img
			src="/icon.svg"
			alt="Jolly Roger"
			class="mx-auto mb-6 h-32 w-32 drop-shadow-lg"
		/>
		<h1 class="mb-4 text-4xl font-bold tracking-tight">About Jolly Roger</h1>
		<p class="text-xl text-muted-foreground">
			A production-ready template for building decentralized applications
		</p>
	</div>

	<!-- Mission Section -->
	<section class="mb-12">
		<div class="rounded-lg border bg-card p-8">
			<div class="mb-4 flex items-center gap-3">
				<HeartIcon class="h-6 w-6 text-primary" />
				<h2 class="text-2xl font-bold">Our Mission</h2>
			</div>
			<p class="mb-4 text-muted-foreground">
				Jolly Roger is a full-stack onchain app template: smart contracts, a
				frontend, and a built-in explorer that talks to them, wired to run
				together locally with hot contract replacement — edit a contract and
				the app picks up the new code without losing its address.
			</p>
			<p class="text-muted-foreground">
				It exists because starting an onchain app means re-stitching the same
				pieces every time: the deploy system, the ABI export to the frontend,
				wallet connection, the read layer, IPFS and PWA setup. Jolly Roger
				ships those decisions already made, so you start at the part that's
				actually yours.
			</p>
		</div>
	</section>

	<!-- Tech Stack Section -->
	<section class="mb-12">
		<div class="mb-6 flex items-center gap-3">
			<CodeIcon class="h-6 w-6 text-primary" />
			<h2 class="text-2xl font-bold">Technology Stack</h2>
		</div>

		<div class="grid gap-4 md:grid-cols-2">
			<div class="rounded-lg border bg-card p-6">
				<h3 class="mb-3 text-lg font-semibold text-primary">Smart Contracts</h3>
				<ul class="space-y-2 text-sm text-muted-foreground">
					<li>
						• <strong>Hardhat v3</strong> - Ethereum development environment
					</li>
					<li>
						• <strong>hardhat-deploy v2 + rocketh</strong> - Deployment system
					</li>
					<li>
						• <strong>TypeScript</strong> - Type-safe contract scripts
					</li>
					<li>• <strong>Solidity</strong> - Smart contract language</li>
				</ul>
			</div>

			<div class="rounded-lg border bg-card p-6">
				<h3 class="mb-3 text-lg font-semibold text-primary">Frontend</h3>
				<ul class="space-y-2 text-sm text-muted-foreground">
					<li>• <strong>SvelteKit 5</strong> - Full-stack web framework</li>
					<li>• <strong>Vite</strong> - Build tool and dev server</li>
					<li>• <strong>Tailwind CSS 4</strong> - Utility-first CSS</li>
					<li>• <strong>shadcn-svelte</strong> - UI components</li>
				</ul>
			</div>

			<div class="rounded-lg border bg-card p-6">
				<h3 class="mb-3 text-lg font-semibold text-primary">Web3</h3>
				<ul class="space-y-2 text-sm text-muted-foreground">
					<li>• <strong>viem</strong> - TypeScript Ethereum library</li>
					<li>• <strong>PWA Support</strong> - Works offline</li>
					<li>• <strong>IPFS Ready</strong> - Decentralized hosting</li>
				</ul>
			</div>

			<div class="rounded-lg border bg-card p-6">
				<h3 class="mb-3 text-lg font-semibold text-primary">Developer Tools</h3>
				<ul class="space-y-2 text-sm text-muted-foreground">
					<li>• <strong>Hot Contract Replacement</strong> - Edit contracts, keep the address</li>
					<li>• <strong>TypeScript</strong> - End-to-end type safety</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- Creator Section -->
	<section class="mb-12">
		<div class="mb-6 flex items-center gap-3">
			<UsersIcon class="h-6 w-6 text-primary" />
			<h2 class="text-2xl font-bold">Creator</h2>
		</div>

		<div class="rounded-lg border bg-card p-8">
			<div
				class="flex flex-col items-center text-center md:flex-row md:items-start md:text-left"
			>
				<div class="mb-4 md:mr-6 md:mb-0">
					<div
						class="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-3xl font-bold text-primary"
					>
						RS
					</div>
				</div>
				<div>
					<h3 class="mb-2 text-xl font-semibold">Ronan Sandford</h3>
					<p class="mb-4 text-muted-foreground">
						Ethereum developer and creator of various open-source projects
						including Bleeps, Mandalas, and Conquest. Passionate about building
						decentralized applications that are truly eternal - apps that can
						run forever without external dependencies.
					</p>
					<div class="flex flex-wrap justify-center gap-4 md:justify-start">
						<Button
							href="https://twitter.com/wighawag"
							variant="outline"
							size="sm"
							target="_blank"
							rel="noopener noreferrer"
						>
							<TwitterIcon class="h-4 w-4 fill-white" />
							Twitter
						</Button>
						<Button
							href="https://github.com/wighawag"
							variant="outline"
							size="sm"
							target="_blank"
							rel="noopener noreferrer"
						>
							<GithubIcon class="h-4 w-4 fill-white" />
							GitHub
						</Button>
						<Button
							href="https://ronan.eth.limo"
							variant="outline"
							size="sm"
							target="_blank"
							rel="noopener noreferrer"
						>
							<GlobeIcon class="h-4 w-4" />
							Website
						</Button>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- Get Started Section -->
	<section class="text-center">
		<h2 class="mb-4 text-2xl font-bold">Ready to Build?</h2>
		<p class="mb-6 text-muted-foreground">
			Start building your decentralized application today with Jolly Roger.
		</p>
		<CopyCommand command="npx degit wighawag/jolly-roger my-app" class="mb-6" />
		<div class="flex flex-wrap justify-center gap-4">
			<Button
				href="https://github.com/wighawag/jolly-roger"
				size="lg"
				target="_blank"
				rel="noopener noreferrer"
			>
				View on GitHub
			</Button>
			<Button
				href="https://github.com/wighawag/jolly-roger#readme"
				variant="outline"
				size="lg"
				target="_blank"
				rel="noopener noreferrer"
			>
				Read the Docs
			</Button>
		</div>
	</section>
</div>
