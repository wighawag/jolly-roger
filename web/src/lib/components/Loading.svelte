<script lang="ts">
  export let cancel: () => void = () => {};
  cancel;
</script>

<div class="page-loading" />

<style>
  @keyframes scale {
    from {
      width: 0;
    }
    to {
      width: 100%;
    }
  }
  @keyframes flicker {
    from {
      background-color: #aaaaaa;
    }
    to {
      background-color: #d61f69;
    }
  }
  .page-loading::before {
    content: ' ';
    display: block;
    position: fixed;
    z-index: 10;
    height: 2px;
    width: 100%;
    top: 0;
    left: 0;
    background-color: #06d;
    animation: flicker infinite ease-out 2s, scale 2s;
    box-shadow: 0 2px 2px rgba(0, 0, 0, 0.2);
  }
</style>
