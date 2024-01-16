<script lang="ts">
	export let value: number;
	export let style: string = '';

	$: val = Math.floor(value * 100) / 100;

	$: fullStyle = `--progress-value:${val}%;--progress-value-text:'${val}%';${style}`;
</script>

<div class="progress-bar" style={fullStyle}>
	<progress value={val} max="100" style="visibility:hidden;height:0;width:0;">{val}%</progress>
</div>

<style>
	.progress-bar {
		display: flex;
		justify-content: center;
		align-items: center;

		width: 100px;
		height: 100px;
		border-radius: 50%;
		background: radial-gradient(closest-side, var(--progress-bg-color, black) 79%, transparent 80% 100%),
			conic-gradient(var(--progress-color, white) var(--progress-value), var(--progress-dim-color, gray) 0);
	}

	.progress-bar::before {
		color: var(--progress-color, white);
		content: var(--progress-value-text);
	}
</style>
