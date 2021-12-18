<script lang="ts">
  import {onMount} from 'svelte';
  import localCache from '$lib/utils/localCache';
  import {base} from '$app/paths';
  type BeforeInstallPromptEvent = Event & {
    prompt: () => void;
    userChoice: Promise<{outcome: string}>;
  };

  let show = false;

  let deferredPrompt: BeforeInstallPromptEvent;
  function getVisited() {
    return localCache.getItem('install-prompt') === 'true';
  }
  function setVisited() {
    localCache.setItem('install-prompt', 'true');
  }
  function beforeinstallprompt(event: Event) {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
  }
  function decline() {
    show = false;
    setVisited();
  }
  function skip() {
    show = false;
  }
  function install() {
    show = false;
    setVisited();
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
      // (choice) => {}
      // TODO ?
    });
  }
  function trigger() {
    if (!getVisited() && performance.now() > 2000) {
      setTimeout(() => (show = true), 1000);
    }
  }
  onMount(() => {
    window.addEventListener('beforeinstallprompt', beforeinstallprompt);
  });
</script>

<!-- this fails typing, so instead we use onMount-->
<!-- <svelte:window on:beforeinstallprompt={beforeinstallprompt} /> -->

<svelte:window on:click={skip} on:scroll={trigger} />

{#if deferredPrompt && show}
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
    <div class="max-w-sm w-full dark:bg-gray-800 bg-white shadow-lg rounded-lg pointer-events-auto">
      <div class="p-4">
        <div class="flex items-start">
          <div class="flex-shrink-0 pt-0.5">
            <img class="h-10 w-10 rounded-full" src={`${base}/maskable_icon_512x512.png`} alt="Jolly Roger" />
          </div>
          <div class="ml-3 w-0 flex-1">
            <p class="text-sm font-medium dark:text-gray-100 text-black">
              Do you want to install Jolly Roger on your home screen?
            </p>
            <!-- <p class="mt-1 text-sm text-gray-500">
            Install it for later
          </p> -->
            <div class="mt-4 flex">
              <button
                on:click={install}
                type="button"
                class="inline-flex items-center px-3 py-2 border border-transparent shadow-sm text-sm leading-4 font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                Install
              </button>
              <button
                on:click={decline}
                type="button"
                class="ml-3 inline-flex items-center px-3 py-2 border border-red-800 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-200 bg-red-500 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-300"
              >
                Decline
              </button>
            </div>
          </div>
          <div class="ml-4 flex-shrink-0 flex">
            <button
              on:click={decline}
              class="dark:bg-gray-900 bg-white  rounded-md inline-flex text-red-400 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
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
