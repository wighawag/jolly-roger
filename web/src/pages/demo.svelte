<script lang="ts">
  import WalletAccess from '../templates/WalletAccess.svelte';
  import Button from '../components/Button.svelte';
  import Blockie from '../components/Blockie.svelte';
  import {test} from '{{=_.paramCase(it.name)}}-common';
  import {logs} from 'named-logs';
  import messages from '../stores/messages';
  import {wallet, flow, chain} from '../stores/wallet';

  async function setMessage() {
    await flow.execute((contracts) => contracts.{{=_.pascalCase(it.contractName)}}.setMessage(message));
  }

  const console = logs('app:home');

  messages.fetch();

  let message: string = undefined;

  console.log('CommonLib', test('0x0000000000000000000000000000000000000001', 'hello'));
</script>

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

<WalletAccess>
  <section class="py-8 px-4">
    {#if !$messages.state}
      <div>Messages not loaded</div>
    {:else if $messages.error}
      <div>Error: {$messages.error}</div>
    {:else if $messages.state === 'Fetching'}
      <div>Loading Messages...</div>
    {:else}
      {#each $messages.data as message, index}
        <!-- <Blockie address={name.id} /> -->
        <div
          class={`flex flex-wrap items-center -mx-2 ${message.id === $wallet.address ? 'font-bold' : 'font-normal'}`}>
          <!-- <div class="px-2 mb-6">
            <h2 class="text-xl">{`${name.id.slice(0, 4)}...${name.id.slice(name.id.length - 4)}`} :</h2>
          </div> -->
          <Blockie address={message.id} class="m-1" />
          <span class="px-2">
            <p>{message.message}</p>
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
        bind:value={message} />
      <button
        disabled={!message || message === ''}
        on:click={setMessage}
        class="flex-shrink-0 bg-pink-600 hover:bg-pink-700 border-pink-600 hover:border-pink-700 text-sm border-4
          text-white py-1 px-2 rounded disabled:bg-gray-400 disabled:border-gray-400 disabled:cursor-not-allowed"
        type="button">
        Say It!
      </button>
    </div>
  </form>

  {#if $wallet.state === 'Ready'}
    <form class="mt-5 w-full max-w-sm">
      <div class="flex items-center">
        <Button disabled={$wallet.unlocking || $chain.connecting} on:click={() => wallet.disconnect()}>
          Disconnect
        </Button>
      </div>
    </form>
  {/if}
</WalletAccess>
