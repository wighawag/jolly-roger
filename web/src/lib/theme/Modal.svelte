<script lang="ts">
  import {createEventDispatcher, onDestroy} from 'svelte';
  export let globalCloseButton = false;
  export let closeButton = false;
  export let title = '';
  export let cancelable = true;

  const dispatch = createEventDispatcher();
  const close = () => cancelable && dispatch('close');

  let modal: Element;

  function handle_keydown(evt: KeyboardEvent | undefined) {
    evt = evt || (window.event as KeyboardEvent);
    var isEscape = false;
    if ('key' in evt) {
      isEscape = evt.key === 'Escape' || evt.key === 'Esc';
    } else {
      isEscape = (evt as KeyboardEvent).keyCode === 27;
    }
    if (isEscape) {
      close();
      return;
    }

    if (evt.key === 'Tab') {
      // trap focus
      const nodes = modal.querySelectorAll('*');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tabbable = Array.from(nodes).filter((n: any) => n.tabIndex >= 0);

      let index = -1;
      if (document.activeElement) {
        index = tabbable.indexOf(document.activeElement);
      }
      if (index === -1 && evt.shiftKey) index = 0;

      index += tabbable.length + (evt.shiftKey ? -1 : 1);
      index %= tabbable.length;

      (tabbable[index] as HTMLElement).focus && (tabbable[index] as HTMLElement).focus();
      evt.preventDefault();
    }
  }

  const previously_focused = typeof document !== 'undefined' && document.activeElement;

  if (previously_focused) {
    onDestroy(() => {
      const htmlElement = previously_focused as HTMLElement;
      if (htmlElement.focus) {
        htmlElement.focus();
      }
    });
  }
</script>

<svelte:window on:keydown={handle_keydown} />

<!-- container -->
<div class="z-50 fixed w-full h-full top-0 left-0 flex items-center justify-center text-black dark:text-white">
  <!-- clickable dark overlay -->
  <div on:click={close} class="absolute w-full h-full bg-gray-900 opacity-80" />

  <!--modal-->
  <div
    class="absolute border-2 w-11/12 md:max-w-md mx-auto overflow-y-auto max-h-screen dark:bg-black dark:border-2 dark:border-gray-800 bg-white"
  >
    {#if globalCloseButton}
      <div
        on:click={close}
        class="modal-close absolute top-0 right-0 cursor-pointer flex flex-col items-center mt-4 mr-4 text-sm"
      >
        <svg
          class="fill-current text-white"
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 18 18"
        >
          <path
            d="M14.53 4.53l-1.06-1.06L9 7.94 4.53 3.47 3.47 4.53 7.94 9l-4.47 4.47 1.06 1.06L9 10.06l4.47 4.47 1.06-1.06L10.06 9z"
          />
        </svg>
        <span class="text-sm">(Esc)</span>
      </div>
    {/if}

    <!-- Add margin if you want to see some of the overlay behind the modal-->
    <div class="modal-content py-4 text-left px-6" bind:this={modal}>
      <div class="flex justify-between items-center">
        <!--Title-->
        {#if title}
          <p class="text-2xl font-bold">{title}</p>
        {/if}
        {#if closeButton}
          <div on:click={close} class="modal-close cursor-pointer z-50">
            <svg
              class="fill-current text-black"
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 18 18"
            >
              <path
                d="M14.53 4.53l-1.06-1.06L9 7.94 4.53 3.47 3.47 4.53 7.94 9l-4.47 4.47 1.06 1.06L9 10.06l4.47 4.47 1.06-1.06L10.06 9z"
              />
            </svg>
          </div>
        {/if}
      </div>

      <!--Body-->
      <slot />

      <!--Footer-->
      <div class="flex justify-end pt-2">
        <slot name="footer" />
      </div>
    </div>
  </div>
</div>
