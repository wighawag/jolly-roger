<script lang="ts">
  export let title: string = undefined;
  import Button from '../components/Button.svelte';
  import Toast from '../components/Toast.svelte';
  import Modal from '../components/Modal.svelte';

  import {wallet, builtin, chain, transactions, balance, flow} from '../stores/wallet';

  const base: string = window.basepath || '/';

  $: executionError = $flow.executionError as any;

  let options: {img: string; id: string; name: string}[] = [];
  $: options = $wallet.options.map((v) => {
    return {
      img: ((v) => {
        if (v === 'builtin') {
          if ($builtin.state === 'Ready') {
            if ($builtin.vendor === 'Metamask') {
              return 'images/metamask.svg';
            } else if ($builtin.vendor === 'Opera') {
              return 'images/opera.svg';
            }
          }
          return 'images/web3-default.png';
        } else {
          if (v.startsWith('torus-')) {
            const verifier = v.slice(6);
            return `images/torus/${verifier}.svg`;
          }
          return `images/${v}.svg`;
        }
      })(v),
      id: v,
      name: v,
    };
  });

  let flashQueue: {message: string; title: string; acknowledge: () => void}[] = [];
  $: if ($chain.error && $chain.notSupported) {
    flashQueue.push({
      title: 'Wrong Chain',
      message: 'Please switch to the mainnet',
      acknowledge: chain.acknowledgeError,
    });
    flashQueue = flashQueue;
  }
  function acknowledgeFlash() {
    const flash = flashQueue.shift();
    if (flash) {
      flash.acknowledge();
    }
    flashQueue = flashQueue;
  }
</script>

{#if flashQueue && flashQueue.length > 0}
  <Toast on:close={acknowledgeFlash}>
    <strong class="font-bold">{flashQueue[0].title}</strong>
    <span class="block sm:inline">{flashQueue[0].message}</span>
  </Toast>
{/if}

<slot />

{#if $flow.inProgress}
  <Modal {title} on:close={() => flow.cancel()} closeButton={false}>
    {#if $wallet.state === 'Idle'}
      {#if $wallet.loadingModule}
        Loading module: {$wallet.selected}
      {:else if $wallet.connecting}
        Connecting to wallet...
      {:else}
        <p>You need to connect your wallet.</p>
        <div class="flex items-cemter pb-3">
          {#each options as option}
            <img
              class="cursor-pointer p-2 m-2 border-2 h-12 w-12 object-contain"
              alt={`Login with ${option.name}`}
              src={`${base}${option.img}`}
              on:click={() => wallet.connect(option.id)} />
          {/each}
        </div>
        <!-- {#each $wallet.options as option}
          <Button label="Connect to Wallet" on:click={() => wallet.connect(option)}>{option}</Button>
        {/each} -->
      {/if}
    {:else if $wallet.state === 'Locked'}
      {#if $wallet.unlocking}
        Please accept the application to access your wallet.
      {:else}
        <Button label="Unlock Wallet" on:click={() => wallet.unlock()}>Unlock</Button>
      {/if}
    {:else if $chain.state === 'Idle'}
      {#if $chain.connecting}Connecting...{/if}
    {:else if $chain.state === 'Connected'}
      {#if $chain.loadingData}Loading contracts...{:else if $chain.notSupported}Please switch to mainnet{/if}
    {:else if $wallet.pendingUserConfirmation}
      Please accept transaction...
    {:else if executionError}
      {#if executionError.code === 4001}
        You rejected the request
      {:else if executionError.message}{executionError.message}{:else}Error: {executionError}{/if}
      <Button label="Retry" on:click={() => flow.retry()}>Retry</Button>
    {/if}
  </Modal>
{/if}
