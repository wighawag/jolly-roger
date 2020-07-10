<script>
  import {
    wallet,
    builtin,
    transactions,
    chain,
    balance,
  } from '../stores/wallet';
  import Button from '../components/basic/Button.svelte';
</script>

<h1>Builtin</h1>
<p>
  {JSON.stringify($builtin, null, ' ')}
</p>

<h1>Wallet</h1>
<p>
  {JSON.stringify($wallet, null, ' ')}
</p>

<h1>Chain</h1>
<p>
  {JSON.stringify($chain, null, ' ')}
</p>

<h1>Balance</h1>
<p>
  {JSON.stringify($balance, null, ' ')}
</p>

<Button class="m-1" on:click="{() => builtin.probe()}">probeBuiltin</Button>
<Button class="m-1" on:click="{() => wallet.connect('builtin')}"
  >builtin</Button
>
<Button class="m-1" on:click="{() => wallet.connect('torus')}">torus</Button>
<Button class="m-1" on:click="{() => wallet.connect('walletconnect')}"
  >wallet connect</Button
>
<Button class="m-1" on:click="{() => wallet.unlock()}">unlock</Button>
<Button class="m-1" on:click="{() => wallet.logout()}">logout</Button>
