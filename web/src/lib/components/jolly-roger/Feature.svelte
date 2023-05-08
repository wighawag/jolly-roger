<script lang="ts">
	export let title: string;
</script>

<div class="rounded-base border-base">
	<div class="mt-10">
		<h3 class="text-lg leading-6 font-medium text-primary">
			{title}
		</h3>
		<p class="mt-2 leading-6">
			<slot />
		</p>
	</div>
</div>
