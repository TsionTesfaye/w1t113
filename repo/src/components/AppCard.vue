<script setup lang="ts">
defineProps<{
  title?: string;
  subtitle?: string;
}>();
</script>

<template>
  <section class="card">
    <header v-if="title || subtitle" class="card__header">
      <h2 v-if="title" class="card__title">{{ title }}</h2>
      <p v-if="subtitle" class="card__subtitle">{{ subtitle }}</p>
    </header>
    <div class="card__content">
      <slot />
    </div>
  </section>
</template>
