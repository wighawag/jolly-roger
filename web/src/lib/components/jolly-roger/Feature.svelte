<script lang="ts">
	interface Props {
		title: string;
		children?: import('svelte').Snippet;
	}

	let { title, children }: Props = $props();
</script>

<div class="rounded-base border-base">
	<div class="mt-10">
		<h3 class="text-lg leading-6 font-medium text-primary">
			{title}
		</h3>
		<p class="mt-2 leading-6">
			{@render children?.()}
		</p>
	</div>
</div>
