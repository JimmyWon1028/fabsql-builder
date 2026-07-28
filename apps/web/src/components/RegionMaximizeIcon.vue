<script setup lang="ts">
defineProps<{
  maximized: boolean
}>()
</script>

<template>
  <svg
    class="region-maximize-icon"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      v-if="maximized"
      d="M3 9h6V3 M21 9h-6V3 M3 15h6v6 M21 15h-6v6"
    />
    <path
      v-else
      d="M8 3H3v5 M16 3h5v5 M8 21H3v-5 M16 21h5v-5"
    />
  </svg>
</template>
