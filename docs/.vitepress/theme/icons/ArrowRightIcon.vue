<template>
  <svg :width="size" :height="size" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 16 });
</script>
