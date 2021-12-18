<script lang="ts">
  import WalletAccess from '$lib/blockchain/WalletAccess.svelte';
  import NavButton from '$lib/components/styled/navigation/NavButton.svelte';
  import Blockie from '$lib/components/generic/CanvasBlockie.svelte';
  import {messages} from '$lib/messages/messages';
  import {wallet, flow, chain} from '$lib/blockchain/wallet';
  import {onMount} from 'svelte';
  import {combine} from 'jolly-roger-common';

  let message = '';
  async function setMessage() {
    await flow.execute((contracts) => contracts.GreetingsRegistry.setMessage(message));
  }

  onMount(() => {
    console.log('mount demo', {
      combine: combine(wallet.address || '0x0000000000000000000000000000000000000000', 'hi').toString(),
    });
  });
</script>

<symbol id="icon-spinner6" viewBox="0 0 32 32">
  <path
    d="M12 4c0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.209-1.791 4-4 4s-4-1.791-4-4zM24.719 16c0 0 0 0 0 0 0-1.812 1.469-3.281 3.281-3.281s3.281 1.469 3.281 3.281c0 0 0 0 0 0 0 1.812-1.469 3.281-3.281 3.281s-3.281-1.469-3.281-3.281zM21.513 24.485c0-1.641 1.331-2.972 2.972-2.972s2.972 1.331 2.972 2.972c0 1.641-1.331 2.972-2.972 2.972s-2.972-1.331-2.972-2.972zM13.308 28c0-1.487 1.205-2.692 2.692-2.692s2.692 1.205 2.692 2.692c0 1.487-1.205 2.692-2.692 2.692s-2.692-1.205-2.692-2.692zM5.077 24.485c0-1.346 1.092-2.438 2.438-2.438s2.438 1.092 2.438 2.438c0 1.346-1.092 2.438-2.438 2.438s-2.438-1.092-2.438-2.438zM1.792 16c0-1.22 0.989-2.208 2.208-2.208s2.208 0.989 2.208 2.208c0 1.22-0.989 2.208-2.208 2.208s-2.208-0.989-2.208-2.208zM5.515 7.515c0 0 0 0 0 0 0-1.105 0.895-2 2-2s2 0.895 2 2c0 0 0 0 0 0 0 1.105-0.895 2-2 2s-2-0.895-2-2zM28.108 7.515c0 2.001-1.622 3.623-3.623 3.623s-3.623-1.622-3.623-3.623c0-2.001 1.622-3.623 3.623-3.623s3.623 1.622 3.623 3.623z"
  />
</symbol>
<WalletAccess>
  <section class="py-8 px-4">
    {#if !$messages.step}
      <div>Messages not loaded</div>
    {:else if $messages.error}
      <div>Error: {$messages.error}</div>
    {:else if $messages.step === 'LOADING' || !$messages.data}
      <div>Loading Messages...</div>
    {:else}
      {#each $messages.data as message, index}
        <!-- <Blockie address={name.id} /> -->
        <div
          class={`flex flex-wrap items-center -mx-2 ${
            $wallet.address && message.id.toLowerCase() === $wallet.address.toLowerCase() ? 'font-bold' : 'font-normal'
          } dark:text-white`}
        >
          <!-- <div class="px-2 mb-6">
              <h2 class="text-xl">{`${name.id.slice(0, 4)}...${name.id.slice(name.id.length - 4)}`} :</h2>
            </div> -->
          <Blockie address={message.id} class="m-1 h-6 w-6" />
          <span class="px-2">
            <p>
              {message.message}
              {#if message.pending}
                <svg class="fill-current animate-spin inline h-4 w-4 dark:text-white"
                  ><use xlink:href="#icon-spinner6" /></svg
                >
              {/if}
            </p>
          </span>
        </div>
      {/each}
    {/if}
  </section>

  <form class="w-full max-w-sm">
    <div class="flex items-center border-b border-pink-600 py-2">
      <input
        class="appearance-none bg-transparent border-none w-full text-gray-700 dark:text-gray-300 mr-3 py-1 px-2
            leading-tight focus:outline-none"
        type="text"
        placeholder="Hello world!"
        aria-label="Your Message"
        bind:value={message}
      />
      <button
        disabled={!message || message === ''}
        on:click={setMessage}
        class="flex-shrink-0 bg-pink-600 hover:bg-pink-700 border-pink-600 hover:border-pink-700 text-sm border-4
            text-white py-1 px-2 rounded disabled:bg-gray-400 disabled:border-gray-400 disabled:cursor-not-allowed"
        type="button"
      >
        Say It!
      </button>
    </div>
  </form>

  {#if $wallet.state === 'Ready'}
    <form class="mt-5 w-full max-w-sm">
      <div class="flex items-center">
        <NavButton
          label="Disconnect"
          disabled={$wallet.unlocking || $chain.connecting}
          on:click={() => wallet.disconnect()}
        >
          Disconnect
        </NavButton>
      </div>
    </form>
  {/if}
</WalletAccess>

<style>
  ::-webkit-input-placeholder {
    /* Chrome/Opera/Safari */
    color: gray;
    opacity: 0.5;
  }
  ::-moz-placeholder {
    /* Firefox 19+ */
    color: gray;
    opacity: 0.5;
  }
  :-ms-input-placeholder {
    /* IE 10+ */
    color: gray;
    opacity: 0.5;
  }
  :-moz-placeholder {
    /* Firefox 18- */
    color: gray;
    opacity: 0.5;
  }
  @media (prefers-color-scheme: dark) {
    ::-webkit-input-placeholder {
      /* Chrome/Opera/Safari */
      color: pink;
      opacity: 0.5;
    }
    ::-moz-placeholder {
      /* Firefox 19+ */
      color: pink;
      opacity: 0.5;
    }
    :-ms-input-placeholder {
      /* IE 10+ */
      color: pink;
      opacity: 0.5;
    }
    :-moz-placeholder {
      /* Firefox 18- */
      color: pink;
      opacity: 0.5;
    }
  }
</style>
