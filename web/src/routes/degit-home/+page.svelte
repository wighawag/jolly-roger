<script lang="ts">
	import {name} from 'web-config';
	import {route, url} from '$lib/utils/path';
</script>

<section class="py-2 px-4 text-center">
	<div class="max-w-auto md:max-w-lg mx-auto">
		<img
			class="mb-1 mx-auto"
			src={url('/icon.svg')}
			alt={name}
			style="width:256px;height:256px;"
			width="256px"
			height="256px"
		/>
		<h2
			class="mb-2 text-title font-black bg-gradient-to-br from-pink-600 via-pink-600 to-purple-600 bg-clip-text text-transparent box-decoration-clone"
		>
			{name}
		</h2>
		<div class="!text-xl flex justify-center space-x-2">
			<h3>
				<span class="bg-gradient-to-br from-blue-500 to-cyan-300 bg-clip-text text-transparent box-decoration-clone"
					>Build</span
				>
			</h3>
			<h3>and</h3>
			<h3>
				<span class="bg-gradient-to-br from-red-500 to-yellow-500 bg-clip-text text-transparent box-decoration-clone"
					>Deploy</span
				>
			</h3>
			<h3>for</h3>
			<h3>
				<span class="bg-gradient-to-br from-pink-500 to-violet-500 bg-clip-text text-transparent box-decoration-clone"
					>Eternity.</span
				>
			</h3>
		</div>
		<p class="my-6 m-6 !text-3xl font-black">Welcome to your <span id="spin" />!</p>
		<div class="max-w-md mx-auto pt-1 mt-5 space-y-3 md:m-8 md:space-y-5">
			<div class="space-y-5 sm:flex sm:justify-center sm:space-y-0 sm:space-x-3">
				<a class="btn btn-primary btn-wide" href={route('/demo/')} aria-label="Try the Demo!">Demo</a>
			</div>
		</div>
	</div>
</section>

<style>
	#spin {
		color: #db2777;
	}
	#spin:after {
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
</style>
