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
