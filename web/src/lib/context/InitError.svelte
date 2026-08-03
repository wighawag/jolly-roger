<script lang="ts">
	// Shown instead of the app when it cannot run at all: an illegal env
	// combination, or a `?burner=true` that cannot be honoured. Driven by the
	// context's `fatal` store (see ADR-0002), so an env misconfiguration also
	// lands in the prerendered HTML of every page, which is about as loud a
	// signal as a failed build.
	interface Props {
		message: string;
	}

	let {message}: Props = $props();
</script>

<div
	class="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center"
>
	<p class="text-lg font-semibold text-destructive">Failed to initialize</p>
	<p class="max-w-md text-sm text-muted-foreground">
		{message || 'Unknown error'}
	</p>
	<button
		class="rounded-md border px-4 py-2 text-sm hover:bg-muted"
		onclick={() => window.location.reload()}
	>
		Reload
	</button>
</div>
