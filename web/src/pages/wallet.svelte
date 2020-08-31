<script lang="ts">
  import {wallet, builtin} from '../stores/wallet';
</script>

{JSON.stringify($wallet, null, ' ')}
<br />
<button on:click={() => builtin.probe()}>probe Builtin</button>
<br />
<button on:click={() => wallet.connect('builtin')}>builtin</button>
<br />
<button on:click={() => wallet.connect('portis')}>portis</button>
<br />
<button on:click={() => wallet.unlock()}>unlock</button>
<br />
