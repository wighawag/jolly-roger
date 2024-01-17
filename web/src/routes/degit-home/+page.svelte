<script lang="ts">
	import {name} from 'web-config';
	import {route, url} from '$lib/utils/path';
</script>

<section class="top">
	<img src={url('/icon.svg')} alt={name} style="width:256px;height:256px;" width="256px" height="256px" />
	<h1 class="text-gradient">
		{name}
	</h1>
	<h2 class="text-build-deploy-eternity">
		<span class="text-gradient text-build">Build</span>
		<span>and</span>
		<span class="text-gradient text-deploy">Deploy</span>
		<span>for</span>
		<span class="text-gradient text-eternity">Eternity.</span>
	</h2>
	<p class="welcome">Welcome to your <span class="spin" />!</p>
	<div class="wrapper">
		<div class="button-wrapper">
			<a role="button" class="primary" href={route('/demo/')} aria-label="Try the Demo!">Demo</a>
		</div>
	</div>
</section>

<style>
	/* Structure */
	section {
		text-align: center;
		margin-inline: auto;
		max-width: 600px;
		padding-inline: 16px;
	}

	section > img {
		margin-inline: auto;
	}

	/* Style */
	.text-gradient {
		background-clip: text;
		color: rgba(0, 0, 0, 0);
		background-image: linear-gradient(to right bottom, rgb(219, 39, 119), rgb(219, 39, 119), rgb(147, 51, 234));
	}

	h1 {
		margin-top: 4px;
		margin-bottom: 32px;
		font-size: 3.75rem;
		background-image: linear-gradient(to right bottom, rgb(219, 39, 119), rgb(219, 39, 119), rgb(147, 51, 234));
	}

	p,
	h2 {
		margin-block: 24px;
	}
	.text-build-deploy-eternity {
		font-size: x-large;
	}
	.text-build {
		background-image: linear-gradient(to right bottom, rgb(59, 130, 246), rgb(103, 232, 249));
	}
	.text-deploy {
		background-image: linear-gradient(to right bottom, rgb(239, 68, 68), rgb(234, 179, 8));
	}
	.text-eternity {
		background-image: linear-gradient(to right bottom, rgb(236, 72, 153), rgb(139, 92, 246));
	}

	.welcome {
		margin: 1.5rem;
		margin-top: 1.5rem;
		margin-bottom: 1.5rem;
		font-weight: 900;
		font-size: 1.875rem;
		line-height: 2.25rem;
	}
	.spin {
		color: #db2777;
	}
	.spin:after {
		content: 'Idea';
		animation: spin 4s linear infinite;
	}
	@keyframes spin {
		0% {
			content: 'Idea';
		}
		33% {
			content: 'Game';
		}
		66% {
			content: 'App';
		}
	}

	.wrapper {
		padding-top: 0.25rem;
		margin-top: 1.25rem;
		margin-top: 0.75rem;
		margin-top: 0.875rem;
		max-width: 28rem;
	}

	@media (min-width: 768px) {
		.wrapper {
			margin: 2rem;
			margin-top: 1.25rem;
		}
	}

	.button-wrapper {
		margin-top: 1.25rem;
	}

	@media (min-width: 640px) {
		.button-wrapper {
			display: flex;
			margin-left: 0.75rem;
			margin-left: 0.875rem;
			margin-top: 0;
			justify-content: center;
		}
	}

	a[role='button'] {
		height: 3rem;
		display: flex;
		justify-content: center;
		align-items: center;
		padding-inline: 2rem;
	}
</style>
