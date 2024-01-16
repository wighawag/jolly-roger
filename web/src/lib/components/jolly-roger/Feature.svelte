<script lang="ts">
	export let title: string;
</script>

<div>
	<div>
		<h3>
			{title}
		</h3>
		<p>
			<slot />
		</p>
	</div>
</div>

<style>
	h3 {
		color: var(--color-background-primary-100);
	}

	p,
	h3 {
		margin-block: 24px;
	}
</style>
