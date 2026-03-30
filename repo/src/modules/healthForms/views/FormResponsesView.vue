<script setup lang="ts">
import { useAuthStore } from '@/app/stores/useAuthStore';
import { useHealthFormsStore } from '@/modules/healthForms/stores/useHealthFormsStore';
import { computed, onMounted } from 'vue';

const authStore = useAuthStore();
const formsStore = useHealthFormsStore();

const forms = computed(() => formsStore.bookingForms);
const submittedForms = computed(() => forms.value.filter((item) => item.formStatus === 'submitted'));
const roleLabel = computed(() => {
  if (authStore.currentUser?.role === 'admin') {
    return 'admin';
  }

  if (authStore.currentUser?.role === 'photographer') {
    return 'photographer';
  }

  return 'user';
});
const isStaffViewer = computed(
  () => authStore.currentUser?.role === 'admin' || authStore.currentUser?.role === 'photographer'
);

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

function formatSubmittedAt(timestamp: number | null): string {
  if (typeof timestamp !== 'number') {
    return 'Not submitted';
  }

  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
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
  await formsStore.fetchAccessibleBookingForms();
});
</script>

<template>
  <section class="page-stack forms-page">
    <div class="page-header">
      <div>
        <h2>Health Form Responses</h2>
        <p class="muted">
          View submitted booking declarations available to your {{ roleLabel }} role.
        </p>
        <p v-if="isStaffViewer" class="muted">
          Response payloads remain encrypted for staff. Only submission status metadata is shown here.
        </p>
      </div>
    </div>

    <p v-if="formsStore.errorMessage" class="form-error">
      {{ formsStore.errorMessage }}
    </p>

    <div v-if="formsStore.isLoadingBookings" class="slot-empty-state">
      <p class="slot-empty-state__title">Loading responses</p>
      <p class="slot-empty-state__subtitle">Fetching health form submissions for your bookings.</p>
    </div>

    <div v-else-if="submittedForms.length === 0" class="slot-empty-state">
      <p class="slot-empty-state__title">No responses found</p>
      <p class="slot-empty-state__subtitle">Responses will appear here after clients submit declarations.</p>
    </div>

    <div v-else class="forms-booking-list">
      <article v-for="item in submittedForms" :key="item.bookingId" class="forms-booking-row">
        <div class="forms-booking-row__main">
          <strong>{{ item.serviceName }}</strong>
          <small>{{ formatDateTimeRange(item.startTime, item.endTime) }}</small>
          <small>Submitted: {{ formatSubmittedAt(item.submittedAt) }}</small>
          <small v-if="item.note" class="forms-booking-row__note">{{ item.note }}</small>
        </div>
        <div class="forms-booking-row__actions">
          <span class="pill forms-booking-row__status" :class="`pill--booking-${item.formStatus}`">
            {{ formStatusLabel(item.formStatus) }}
          </span>
          <RouterLink
            v-if="item.canOpen && !isStaffViewer"
            :to="`/forms/${item.bookingId}`"
            class="btn btn--primary forms-booking-row__action"
          >
            View response
          </RouterLink>
          <button v-else type="button" class="btn btn--outline forms-booking-row__action" disabled>
            {{ isStaffViewer ? 'Encrypted' : 'View response' }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
