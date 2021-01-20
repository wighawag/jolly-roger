<script lang="ts">
  import {getRouter} from '@curi/svelte';
  import {createEventDispatcher} from 'svelte';

  let _class: string = '';
  export {_class as class};

  export let params = {};
  export let state: any = null;

  export let href: string | undefined = undefined;
  export let blank: boolean = false;
  export let type: string | undefined = undefined;
  export let label: string;

  export let big: boolean = false;
  export let active: boolean = false;
  export let disabled: boolean = false;
  export let waitOnDisabled: boolean = false;

  export let secondary: boolean = false;
  export let tertiary: boolean = false;
  export let danger: boolean = false;
  export let white: boolean = false;
  $: primary = !secondary && !tertiary && !danger && !white;

  export let customPadding: string = '';

  const dispatch = createEventDispatcher();

  let sizeClasses: string;
  $: {
    sizeClasses = `
            ${customPadding || 'px-4 py-2'}
            text-sm
            border-2
            space-x-1
            rounded-md
            sm:leading-5
        `;
    if (big) {
      sizeClasses = `
                ${customPadding || 'px-8 py-3 md:px-10 md:py-4'}
                border-4
                leading-6
                space-x-3
                rounded-lg
                md:text-lg
            `;
    }
  }

  let colorClasses: string;
  let hoverClasses: string;
  let focusClasses: string;
  let activeClasses: string;
  let activatedClasses: string;
  let disabledClasses: string;
  $: {
    hoverClasses = 'hover:-translate-y-px ';
    focusClasses = 'focus:-translate-y-px ';
    activeClasses = 'active:-translate-y-px ';
    activatedClasses = '-translate-y-px ';
    disabledClasses = 'opacity-50 ' + (waitOnDisabled ? 'cursor-wait ' : '');

    if (primary) {
      colorClasses = `text-white bg-pink-600`;
      hoverClasses += `hover:bg-pink-500`;
      focusClasses += `focus-not-active:bg-pink-500`;
      activeClasses += `active:bg-pink-600 active:border-pink-500`;
      activatedClasses += `bg-pink-600 border-pink-500`;
    } else if (secondary) {
      colorClasses = `
                text-pink-600 bg-gray-100
                dark:text-pink-500 dark:bg-gray-900
            `;
      hoverClasses += `
                hover:bg-gray-50
                dark:hover:bg-gray-800
            `;
      focusClasses += `
                focus-not-active:bg-gray-50
                dark:focus-not-active:bg-gray-800
            `;
      activeClasses += `
                active:bg-gray-100 active:border-gray-50
                dark:active:bg-gray-900 dark:active:border-gray-800
            `;
      activatedClasses += `
                bg-gray-100 border-gray-50
                dark:bg-gray-900 dark:border-gray-800
            `;
    } else if (tertiary) {
      colorClasses = `
                text-gray-500
                dark:text-gray-400
            `;
      hoverClasses += `
                hover:text-gray-600 hover:bg-gray-50
                dark:hover:text-gray-300 dark:hover:bg-gray-900
            `;
      focusClasses += `
                focus-not-active:text-gray-600 focus-not-active:bg-gray-50
                dark:focus-not-active:text-gray-300 dark:focus-not-active:bg-gray-900
            `;
      activeClasses += `
                active:text-gray-600 active:bg-white active:border-gray-50
                dark:active:text-gray-300 dark:active:bg-black dark:active:border-gray-900
            `;
      activatedClasses += `
                bg-transparent text-gray-600 border-gray-50
                dark:text-gray-300 dark:border-gray-900
            `;
    } else if (danger) {
      colorClasses = `text-red-700 bg-red-100`;
      hoverClasses += `hover:bg-red-50`;
      focusClasses += `focus-not-active:bg-red-50`;
      activeClasses += `active:bg-red-100`;
      activatedClasses += `bg-red-100`;
    } else if (white) {
      colorClasses = `text-pink-600 bg-white`;
      hoverClasses += `hover:text-pink-500`;
      focusClasses += `focus-not-active:text-pink-500`;
      activeClasses += `active:text-pink-600`;
      activatedClasses += `text-pink-600`;
    }
  }

  $: classes = `
        w-full
        flex
        items-center
        justify-center
        font-medium
        select-none
        transition
        transform
        duration-150
        ease-in-out
        focus:outline-none
        ${colorClasses}
        ${sizeClasses}
        ${
          disabled
            ? disabledClasses
            : active
            ? activatedClasses
            : `border-transparent ${hoverClasses} ${focusClasses} ${activeClasses}`
        }
        ${_class}
    `;

  let router = getRouter();
  let canNavigate = (event: MouseEvent, target: Element) => {
    return (
      !event.defaultPrevented &&
      !target &&
      event.button === 0 &&
      !(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
    );
  };

  let url: string;
  let target: Element;
  let handlePageLink: (e: MouseEvent) => void;
  $: {
    if (href && !href.startsWith('http')) {
      const split1 = href.split('#');
      const split2 = split1[0].split('?');
      const page = split2[0];
      const hash = split1[1];
      const query = split2[1];
      url = router.url({name: page, params, hash, query});
      target = $$restProps.target;
      handlePageLink = (event) => {
        if (canNavigate(event, target)) {
          event.preventDefault();
          router.navigate({url, state});
        }
      };
    }
  }
</script>

{#if href}
  {#if handlePageLink}
    <a
      aria-label={label}
      title={label}
      href={url}
      {disabled}
      class={classes}
      on:click={handlePageLink}>
      <slot>Name</slot>
    </a>
  {:else}
    <a
      aria-label={label}
      title={label}
      {href}
      rel={blank === true ? 'noopener noreferrer' : ''}
      target={blank === true ? '_blank' : ''}
      {disabled}
      class={classes}>
      <slot>Name</slot>
    </a>
  {/if}
{:else if type}
  <button aria-label={label} title={label} {type} {disabled} class={classes}>
    <slot>Name</slot>
  </button>
{:else}
  <button
    on:click={() => {
      dispatch('click');
    }}
    aria-label={label}
    title={label}
    type="button"
    {disabled}
    class={classes}>
    <slot>Name</slot>
  </button>
{/if}
