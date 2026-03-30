<script setup lang="ts">
import { useHealthFormsStore } from '@/modules/healthForms/stores/useHealthFormsStore';
import { computed, onMounted } from 'vue';

const formsStore = useHealthFormsStore();

const forms = computed(() => formsStore.bookingForms);

function formatDateTimeRange(startTime: number, endTime: number): string {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const startDate = start.toLocaleDateString([], {
    month: 'short',
    day: 'numeric'
  });

  const startClock = start.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });

  const endClock = end.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });

  return `${startDate} · ${startClock} - ${endClock}`;
}

function formStatusLabel(status: string): string {
  if (status === 'submitted') {
    return 'Submitted';
  }

  if (status === 'draft') {
    return 'Draft';
  }

  if (status === 'unavailable') {
    return 'Unavailable';
  }

  return 'Not started';
}

onMounted(async () => {
  await formsStore.fetchClientBookingForms();
});
</script>

<template>
  <section class="page-stack forms-page">
    <div class="page-header">
      <div>
        <h2>Health Forms</h2>
        <p class="muted">Complete declarations linked to your bookings.</p>
      </div>
    </div>

    <p v-if="formsStore.errorMessage" class="form-error">
      {{ formsStore.errorMessage }}
    </p>
    <p v-if="formsStore.successMessage" class="admin-success">
      {{ formsStore.successMessage }}
    </p>

    <div v-if="formsStore.isLoadingBookings" class="slot-empty-state">
      <p class="slot-empty-state__title">Loading forms</p>
      <p class="slot-empty-state__subtitle">Fetching your booking declarations.</p>
    </div>

    <div v-else-if="forms.length === 0" class="slot-empty-state">
      <p class="slot-empty-state__title">No bookings found</p>
      <p class="slot-empty-state__subtitle">
        Health declarations will appear when you have active bookings.
      </p>
    </div>

    <div v-else class="forms-booking-list">
      <article v-for="item in forms" :key="item.bookingId" class="forms-booking-row">
        <div class="forms-booking-row__main">
          <strong>{{ item.serviceName }}</strong>
          <small>{{ formatDateTimeRange(item.startTime, item.endTime) }}</small>
          <small v-if="item.note" class="forms-booking-row__note">{{ item.note }}</small>
        </div>
        <div class="forms-booking-row__actions">
          <span class="pill forms-booking-row__status" :class="`pill--booking-${item.formStatus}`">
            {{ formStatusLabel(item.formStatus) }}
          </span>
          <RouterLink
            v-if="item.canOpen"
            :to="`/forms/${item.bookingId}`"
            class="btn btn--primary forms-booking-row__action"
          >
            Open
          </RouterLink>
          <button v-else type="button" class="btn btn--outline forms-booking-row__action" disabled>
            Open
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
