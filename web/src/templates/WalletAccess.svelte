<script lang="ts">
  export let title: string = undefined;
  import Button from '../components/Button.svelte';
  import Toast from '../components/Toast.svelte';
  import Modal from '../components/Modal.svelte';

  import {wallet, builtin, chain, transactions, balance, flow} from '../stores/wallet';

  const chainNames = {
    '1': 'mainnet',
    '3': 'ropsten',
    '4': 'rinkeby',
    '5': 'goerli',
    '42': 'kovan',
    '1337': 'localhost chain',
    '31337': 'localhost chain',
  };
  const chainId = import.meta.env.VITE_CHAIN_ID;
  const chainName = (() => {
    const name = chainNames[chainId];
    if (name) {
      return name;
    }
    return `chain with id ${chainId}`;
  })();

  const base: string = window.basepath || '/';

  $: executionError = $flow.executionError as any;

  let options: {img: string; id: string; name: string}[] = [];
  $: builtinNeedInstalation = $wallet.options.filter((v) => v === 'builtin' && !$builtin.available).length > 0;
  $: options = $wallet.options
    .filter((v) => v !== 'builtin' || $builtin.available)
    .map((v) => {
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
</script>

<slot />

{#if $flow.inProgress}
  <Modal {title} cancelable={!$wallet.connecting} on:close={() => flow.cancel()} closeButton={false}>
    {#if $wallet.state === 'Idle'}
      {#if $wallet.loadingModule}
        Loading module: {$wallet.selected}
      {:else if $wallet.connecting}
        Connecting to wallet...
      {:else}
        <div class="text-center">
          <p>You need to connect your wallet.</p>
        </div>
        <div class="flex flex-wrap justify-center pb-3">
          {#each options as option}
            <img
              class="cursor-pointer p-2 m-2 border-2 h-12 w-12 object-contain"
              alt={`Login with ${option.name}`}
              src={`${base}${option.img}`}
              on:click={() => wallet.connect(option.id)} />
          {/each}
        </div>
        {#if builtinNeedInstalation}
          <div class="text-center">OR</div>
          <div class="flex justify-center">
            <Button
              label="Download Metamask"
              blank={true}
              href="https://metamask.io/download.html"
              class="m-4 w-max-content">
              <img
                class="cursor-pointer p-0 mx-2 h-10 w-10 object-contain"
                alt={`Download Metamask}`}
                src={`${base}images/metamask.svg`} /> Download metamask
            </Button>
          </div>
        {/if}
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
      {#if $chain.loadingData}Loading contracts...{:else if $chain.notSupported}Please switch to {chainName}{/if}
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
