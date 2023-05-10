<script lang="ts">
	import {serviceWorker} from '$lib/web/serviceWorker';

	export let src: string;
	export let alt: string;

	function skip() {
		$serviceWorker.updateAvailable = false;
	}

	function reload() {
		if ($serviceWorker.updateAvailable && $serviceWorker.registration) {
			if ($serviceWorker.registration.waiting) {
				$serviceWorker.registration.waiting.postMessage('skipWaiting');
			} else {
				console.error(`not waiting..., todo reload?`);
				// window.location.reload();
			}
			$serviceWorker.updateAvailable = false;
		}
	}
</script>

<!-- <svelte:window on:click={skip} /> -->

{#if $serviceWorker.updateAvailable && $serviceWorker.registration}
	<!-- svelte-ignore a11y-click-events-have-key-events-->
	<div
		on:click={(e) => {
			e.preventDefault();
			e.stopPropagation();
		}}
		class="z-50 fixed inset-0 flex items-end justify-center px-4 py-6 pointer-events-none sm:p-6 sm:items-start sm:justify-end"
	>
		<!--
    Notification panel, show/hide based on alert state.

    Entering: "transform ease-out duration-300 transition"
      From: "translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
      To: "translate-y-0 opacity-100 sm:translate-x-0"
    Leaving: "transition ease-in duration-100"
      From: "opacity-100"
      To: "opacity-0"
  -->
		<div class={`max-w-sm w-full shadow-lg rounded-lg pointer-events-auto bg-base-300`}>
			<div class="p-4">
				<div class="flex items-start">
					<div class="flex-shrink-0 pt-0.5">
						<img class="h-16 w-16 rounded-box border-2 border-base-200" {src} {alt} />
					</div>
					<div class="ml-3 w-0 flex-1">
						<p class="text-base font-medium">A new version is available. Reload to get the update.</p>
						<!-- <p class="mt-1 text-sm text-gray-500">
            Install it for later
          </p> -->
						<div class="mt-4 flex">
							<button on:click={reload} type="button" class="btn rounded-btn btn-success btn-sm m-1"> Reload </button>
							<button on:click={skip} type="button" class="btn rounded-btn btn-error btn-sm m-1"> Skip </button>
						</div>
					</div>
					<div class="ml-4 flex-shrink-0 flex">
						<button on:click={skip} class="rounded-md inline-flex btn btn-active btn-sm">
							<span class="sr-only">Close</span>
							<!-- Heroicon name: solid/x -->
							<svg
								class="h-5 w-5"
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 20 20"
								fill="currentColor"
								aria-hidden="true"
							>
								<path
									fill-rule="evenodd"
									d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
									clip-rule="evenodd"
								/>
							</svg>
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
