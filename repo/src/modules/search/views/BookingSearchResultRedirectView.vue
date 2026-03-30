<script setup lang="ts">
import { useAuthStore } from '@/app/stores/useAuthStore';
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();

onMounted(async () => {
  const bookingId = String(route.params.id ?? '').trim();
  if (!bookingId) {
    await router.replace('/');
    return;
  }

  const role = authStore.currentUser?.role;

  if (role === 'admin') {
    await router.replace({
      name: 'admin-bookings',
      query: { bookingId }
    });
    return;
  }

  if (role === 'photographer') {
    await router.replace({
      name: 'photographer-schedule',
      query: { bookingId }
    });
    return;
  }

  if (role === 'client') {
    await router.replace({
      name: 'my-bookings',
      query: { bookingId }
    });
    return;
  }

  await router.replace({
    name: 'community'
  });
});
</script>

<template>
  <section class="page-stack">
    <p class="muted">Opening booking…</p>
  </section>
</template>
