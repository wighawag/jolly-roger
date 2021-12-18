<script lang="ts">
  export let title: string;
</script>

<div>
  <div class="mt-10">
    <h3 class="text-lg leading-6 font-medium text-gray-900 dark:text-gray-500">
      {title}
    </h3>
    <p class="mt-2 text-base leading-6 text-gray-500 dark:text-gray-300">
      <slot />
    </p>
  </div>
</div>
