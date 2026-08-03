<script lang="ts">
	const showcaseApps = [
		{
			name: 'Bleeps',
			url: 'https://bleeps.art',
			image: '/images/website/featured/bleeps-preview-small.webp',
			title: 'The Bleeps DAO and Its Fully Onchain Sounds',
			description:
				'The First Composable Sounds Fully Generated On-Chain With Zero Externalities, no backend, no ipfs, no client-code, and a melody minter where some of the proceeds goes to the Bleeps DAO and its members',
			sourceCode: 'https://github.com/wighawag/bleeps',
		},
		{
			name: 'Mandalas',
			url: 'https://mandalas.eth.limo',
			image: '/images/website/featured/mandalas-preview-small.webp',
			title: 'On-chain Generative Bitmaps With Zero Externalities',
			description:
				'The First On-Chain Generative Art Project to make full use of token URI to remove all external dependencies. It generates SVG and Bitmap from the smart contract directly.',
			sourceCode: 'https://github.com/wighawag/mandalas',
		},
		{
			name: 'Conquest',
			url: 'https://conquest.game',
			image: '/images/website/featured/conquest-preview-small.webp',
			title: 'A Game of Strategy and Diplomacy Running on the EVM',
			description:
				'An unstoppable game of strategy and diplomacy running on the EVM. It allows player to collaborate through on-chain alliances while remaining sovereign. A first of its kind.',
			sourceCode: 'https://github.com/etherplay/conquest-eth',
		},
	];
</script>

<!-- Showcase Section -->
<section class="mb-16">
	<h2 class="mb-4 text-center text-3xl font-bold">Showcase</h2>
	<p class="mb-8 text-center text-muted-foreground">
		Here are examples of apps built using "Jolly Roger"
	</p>

	<div class="grid gap-8 lg:grid-cols-3">
		{#each showcaseApps as app}
			<div
				class="mx-auto flex max-w-125 flex-col overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md lg:mx-0 lg:max-w-none"
			>
				<div class="aspect-video bg-muted">
					{#if app.image}
						<img
							src={app.image}
							alt={app.name}
							class="h-full w-full object-cover"
						/>
					{:else}
						<div
							class="flex h-full items-center justify-center bg-linear-to-br from-muted to-muted/50 p-4"
						>
							<span class="text-2xl font-bold text-muted-foreground"
								>{app.name}</span
							>
						</div>
					{/if}
				</div>
				<div class="flex flex-1 flex-col p-4">
					<a
						href={app.url}
						target="_blank"
						rel="noopener noreferrer"
						class="mb-2 text-center text-primary underline hover:text-primary/80"
					>
						{app.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
					</a>
					<h3 class="mb-2 text-center text-lg font-semibold">{app.title}</h3>
					<p class="mb-4 flex-1 text-center text-sm text-muted-foreground">
						{app.description}
					</p>
					{#if app.sourceCode}
						<p class="text-center text-sm">
							Check the
							<a
								href={app.sourceCode}
								target="_blank"
								rel="noopener noreferrer"
								class="underline hover:text-foreground"
							>
								source code
							</a>.
						</p>
					{:else}
						<p class="text-center text-sm text-muted-foreground">
							Source code not yet available.
						</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</section>
