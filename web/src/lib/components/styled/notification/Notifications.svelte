<script lang="ts">
  import Notification from './Notification.svelte';
  import {notifications} from '$lib/web/notifications';
</script>

<div
  class="z-50 fixed inset-0 flex items-end justify-center px-4 py-6 pointer-events-none sm:p-6 sm:items-start sm:justify-end"
>
  {#if $notifications.current}
    <Notification
      title={$notifications.current.title}
      text={$notifications.current.text}
      type={$notifications.current.type}
      on:close={() => notifications.acknowledge()}
    />
  {/if}
</div>
