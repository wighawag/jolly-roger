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
	p,
	h3 {
		margin-block: 24px;
	}
</style>
