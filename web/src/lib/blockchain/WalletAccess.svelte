<script lang="ts">
  export let title = '';
  import {chainName} from '$lib/config';
  import NavButton from '$lib/components/styled/navigation/NavButton.svelte';
  import Modal from '$lib/components/styled/Modal.svelte';
  import {base} from '$app/paths';
  import {wallet, builtin, chain, flow, fallback} from '$lib/blockchain/wallet';

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

  function acknowledgeNewGenesis() {
    chain.acknowledgeNewGenesisHash();
  }
</script>

<slot />

{#if $chain.state === 'Idle' && !$chain.connecting && $fallback.state === 'Idle' && !$fallback.connecting}
  <!-- Not Used Here: No need of node connection -->
  <!-- <div
    class="w-full flex items-center justify-center fixed top-0 pointer-events-none"
    style="z-index: 5;">
    <p
      class="w-64 text-center rounded-bl-xl rounded-br-xl text-gray-200 bg-pink-600 p-1">
      Please Connect.
    </p>
  </div> -->
{:else if $chain.state === 'Idle' && !$chain.connecting && $fallback.error}
  <!-- Not Used Here: No need of node connection, we should check thegraph connection instead -->
  <!-- <div
    class="w-full flex items-center justify-center fixed top-0 pointer-events-none"
    style="z-index: 5;">
    <p
      class="w-64 text-center rounded-bl-xl rounded-br-xl text-gray-200 bg-pink-600 p-1">
      Network Issues, Please Connect.
    </p>
  </div> -->
{:else if $chain.notSupported}
  <div class="w-full flex items-center justify-center fixed top-0 pointer-events-none" style="z-index: 5;">
    <p class="w-64 text-center rounded-bl-xl rounded-br-xl text-gray-200 bg-pink-600 p-1">
      Wrong network, use
      {chainName}
    </p>
  </div>
{:else if $chain.genesisChanged}
  <div class="w-full flex items-center justify-center fixed top-0" style="z-index: 5;">
    <p class="w-64 text-center rounded-bl-xl rounded-br-xl text-gray-200 bg-red-500 p-1">
      chain reset detected! Metamask need to have its account reset! <button
        class="border-2 border-white p-2"
        on:click={acknowledgeNewGenesis}>OK</button
      >
    </p>
  </div>
{/if}

{#if $wallet.error}
  <Modal title="An Error Happened" on:close={() => wallet.acknowledgeError()}>
    <p class="w-64 text-center text-red-500 p-1">
      {$wallet.error.message}
    </p>
  </Modal>
{:else if $flow.inProgress}
  <Modal {title} cancelable={!$wallet.connecting} on:close={() => flow.cancel()} closeButton={false}>
    {#if $wallet.state === 'Idle'}
      {#if $wallet.loadingModule}
        Loading module:
        {$wallet.selected}
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
              src={`${base}/${option.img}`}
              on:click={() => wallet.connect(option.id)}
            />
          {/each}
        </div>
        {#if builtinNeedInstalation}
          <div class="text-center">OR</div>
          <div class="flex justify-center">
            <NavButton
              label="Download Metamask"
              blank={true}
              href="https://metamask.io/download.html"
              class="m-4 w-max-content"
            >
              <img
                class="cursor-pointer p-0 mx-2 h-10 w-10 object-contain"
                alt={`Download Metamask}`}
                src={`${base}/images/metamask.svg`}
              />
              Download metamask
            </NavButton>
          </div>
        {/if}
      {/if}
    {:else if $wallet.state === 'Locked'}
      {#if $wallet.unlocking}
        Please accept the application to access your wallet.
      {:else}
        <NavButton label="Unlock Wallet" on:click={() => wallet.unlock()}>Unlock</NavButton>
      {/if}
    {:else if $chain.state === 'Idle'}
      {#if $chain.connecting}
        Connecting...
      {:else if $chain.error}
        <div class="text-center">
          <p>{$chain.error?.message || '' + $chain.error}</p>
          <NavButton class="mt-4" label="OK" on:click={() => flow.cancel()}>OK</NavButton>
        </div>
      {/if}
    {:else if $chain.state === 'Connected'}
      {#if $chain.loadingData}
        Loading contracts...
      {:else if $chain.notSupported}
        Please switch to
        {chainName}
        <!-- ({$chain.chainId}) -->
      {/if}
    {:else if executionError}
      <div class="text-center">
        <p>
          {#if executionError.code === 4001}
            You rejected the request
          {:else if executionError.message}{executionError.message}{:else}Error: {executionError}{/if}
        </p>
        <NavButton class="mt-4" label="Retry" on:click={() => flow.retry()}>Retry</NavButton>
      </div>
    {:else if $wallet.pendingUserConfirmation}
      {#if $wallet.pendingUserConfirmation[0] === 'transaction'}
        Please accept transaction...
      {:else if $wallet.pendingUserConfirmation[0] === 'signature'}
        Please accept signature...
      {:else}Please accept request...{/if}
    {:else}
      <div class="text-center">
        <p>Flow aborted {$wallet.state}</p>
        <NavButton class="mt-4" label="Retry" on:click={() => flow.cancel()}>OK</NavButton>
      </div>
    {/if}
  </Modal>
{/if}
