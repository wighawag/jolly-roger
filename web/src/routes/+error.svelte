<script lang="ts">
	import {page} from '$app/state';
	import {Button} from '$lib/shadcn/ui/button';
</script>

<!-- `min-h-full`, not `min-h-screen`: this renders INSIDE the layout's content
     region (`+layout.svelte`), so a viewport-tall box here would be taller than
     the space left by the navbar and any bar that is up, and the error page
     would arrive with a scrollbar. Full means full of what is left. -->
<div class="flex min-h-full items-center justify-center bg-background p-8">
	<div class="max-w-md text-center">
		<h1 class="m-0 text-[6rem] leading-none font-bold text-muted-foreground">
			{page.status}
		</h1>
		<h2 class="mt-4 mb-2 text-2xl font-semibold text-foreground">
			{#if page.status === 404}
				Page Not Found
			{:else if page.status === 500}
				Server Error
			{:else if page.status === 403}
				Access Denied
			{:else if page.status === 401}
				Unauthorized
			{:else}
				Something Went Wrong
			{/if}
		</h2>
		<p class="mb-8 text-muted-foreground">
			{page.error?.message || 'An unexpected error occurred'}
		</p>
		<div class="flex flex-wrap justify-center gap-4">
			<Button href="/">Go Home</Button>
			<Button variant="outline" onclick={() => window.location.reload()}>
				Try Again
			</Button>
		</div>
	</div>
</div>
