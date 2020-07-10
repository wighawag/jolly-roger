<script>
  let className;
  export {className as class};
</script>
<button
  on:click
  class="{`${className} bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded`}"
>
  <slot></slot>
</button>
