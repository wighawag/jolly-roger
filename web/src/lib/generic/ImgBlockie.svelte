<script lang="ts">
  export let address: string;
  export let offset: number = 0;
  export let style: string | undefined = undefined;
  export let _class = '';
  export {_class as class};

  import {Blockie} from '$lib/utils/eth/blockie';

  $: uri = Blockie.getURI(address, offset);
</script>

<img class={_class} {style} src={uri} alt={address} />

<style>
  img {
    image-rendering: -moz-crisp-edges;
    image-rendering: -webkit-crisp-edges;
    image-rendering: crisp-edges;
    image-rendering: pixelated;
  }
</style>
