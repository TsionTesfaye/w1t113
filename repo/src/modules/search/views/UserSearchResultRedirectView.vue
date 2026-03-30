<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

onMounted(async () => {
  const userId = String(route.params.id ?? '').trim();
  if (!userId) {
    await router.replace('/');
    return;
  }

  await router.replace({
    name: 'admin-users',
    query: { userId }
  });
});
</script>

<template>
  <section class="page-stack">
    <p class="muted">Opening user…</p>
  </section>
</template>
