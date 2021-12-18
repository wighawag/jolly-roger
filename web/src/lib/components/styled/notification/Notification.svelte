<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  export let title: string;
  export let text: string;
  export let type: 'error' | 'success' | 'info' | 'warning' = 'info';

  const dispatch = createEventDispatcher();
  const close = () => dispatch('close');
</script>

<div class="max-w-sm w-full dark:bg-black bg-white shadow-lg rounded-lg pointer-events-auto">
  <div class="rounded-lg shadow-xs overflow-hidden dark:border-pink-500 dark:border-2">
    <div class="p-4">
      <div class="flex items-start">
        <div class="flex-shrink-0">
          {#if type !== 'error'}
            <!-- Heroicon name: check-circle -->
            <svg
              class="h-6 w-6 text-green-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          {:else}
            <!-- Heroicon name: x-circle -->
            <svg
              class="h-5 w-5 text-red-400"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clip-rule="evenodd"
              />
            </svg>
          {/if}
        </div>
        <div class="ml-3 w-0 flex-1 pt-0.5">
          <p class="text-sm leading-5 font-medium text-gray-900 dark:text-gray-300">
            {title}
          </p>
          <p class="mt-1 text-sm leading-5 text-gray-500">{text}</p>
        </div>
        <div class="ml-4 flex-shrink-0 flex">
          <button
            on:click={close}
            class="inline-flex text-gray-400 focus:outline-none focus:text-gray-500 transition ease-in-out duration-150"
          >
            <!-- Heroicon name: x -->
            <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
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
