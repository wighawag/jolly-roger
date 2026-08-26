<script lang="ts">
	import {Button} from '$lib/shadcn/ui/button';

	const {data} = $props();
</script>

<svelte:head>
	<title>Error Testing | Debug</title>
</svelte:head>

<!-- `min-h-full` rather than `min-h-screen`, for the reason given in
     src/routes/+error.svelte: a page lives inside the layout's content region,
     and the region is already the viewport minus the chrome. -->
<div class="min-h-full bg-background p-8">
	<div class="mx-auto max-w-2xl">
		<h1 class="mb-2 text-3xl font-bold">Error Page Testing</h1>
		<p class="mb-8 text-muted-foreground">
			Click any button below to trigger the corresponding error and test the
			error page rendering.
		</p>

		<div class="grid gap-4 sm:grid-cols-2">
			{#each data.availableErrors as { status, label }}
				<Button
					href="/debug/error?status={status}"
					variant={status >= 500 ? 'destructive' : 'outline'}
					class="h-auto justify-start px-4 py-3"
				>
					<span class="mr-3 font-mono font-bold">{status}</span>
					<span>{label}</span>
				</Button>
			{/each}
		</div>

		<div class="mt-8 border-t border-border pt-8">
			<h2 class="mb-4 text-xl font-semibold">Custom Error</h2>
			<form
				class="flex flex-wrap items-end gap-4"
				action="/debug/error"
				method="GET"
			>
				<div class="min-w-32 flex-1">
					<label for="status" class="mb-1 block text-sm font-medium"
						>Status Code</label
					>
					<input
						type="number"
						id="status"
						name="status"
						min="400"
						max="599"
						value="500"
						class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
					/>
				</div>
				<div class="min-w-48 flex-[2]">
					<label for="message" class="mb-1 block text-sm font-medium"
						>Message (optional)</label
					>
					<input
						type="text"
						id="message"
						name="message"
						placeholder="Custom error message"
						class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
					/>
				</div>
				<Button type="submit" variant="destructive">Trigger Error</Button>
			</form>
		</div>

		<div class="mt-8">
			<Button href="/" variant="ghost">← Back to Home</Button>
		</div>
	</div>
</div>
