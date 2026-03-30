<script setup lang="ts">
import { toUserErrorMessage } from '@/app/utils/errorMessage';
import AppCard from '@/components/AppCard.vue';
import { useAdminBookingStore } from '@/modules/admin/stores/useAdminBookingStore';
import { useAdminStore } from '@/modules/admin/stores/useAdminStore';
import { useHealthFormsStore } from '@/modules/healthForms/stores/useHealthFormsStore';
import { computed, onMounted, ref } from 'vue';

const adminStore = useAdminStore();
const adminBookingStore = useAdminBookingStore();
const formsStore = useHealthFormsStore();
const fallbackError = ref('');

const isLoading = computed(() => {
  return (
    adminStore.isLoading ||
    adminBookingStore.loading ||
    formsStore.isLoadingBookings
  );
});

const errorMessage = computed(() => {
  return (
    fallbackError.value ||
    adminStore.errorMessage ||
    adminBookingStore.error ||
    formsStore.errorMessage ||
    ''
  );
});

const bookingTotal = computed(() => adminBookingStore.bookings.length);
const bookingConfirmed = computed(
  () => adminBookingStore.bookings.filter((booking) => booking.status === 'confirmed').length
);
const bookingMissed = computed(
  () => adminBookingStore.bookings.filter((booking) => booking.status === 'missed').length
);
const bookingCancelled = computed(
  () => adminBookingStore.bookings.filter((booking) => booking.status === 'canceled').length
);
const bookingCompleted = computed(
  () =>
    adminBookingStore.bookings.filter(
      (booking) => booking.status === 'completed' || booking.status === 'auto_completed'
    ).length
);

const totalUsers = computed(() => adminStore.users.length);
const photographerUsers = computed(
  () => adminStore.users.filter((user) => user.role === 'photographer').length
);
const clientUsers = computed(
  () => adminStore.users.filter((user) => user.role === 'client').length
);

const submittedForms = computed(
  () => formsStore.bookingForms.filter((summary) => summary.formStatus === 'submitted').length
);
const formSubmissionRate = computed(() => {
  if (bookingTotal.value === 0) {
    return '0%';
  }

  const percentage = (submittedForms.value / bookingTotal.value) * 100;
  return `${Math.round(percentage)}%`;
});

async function refreshDashboard(): Promise<void> {
  fallbackError.value = '';
  try {
    await Promise.all([
      adminBookingStore.fetchAllBookings(),
      adminStore.fetchUsers(),
      formsStore.fetchAccessibleBookingForms()
    ]);
  } catch (error: unknown) {
    fallbackError.value = toUserErrorMessage(
      error,
      'Unable to refresh dashboard metrics.'
    );
  }
}

onMounted(() => {
  void refreshDashboard();
});
</script>

<template>
  <section class="page-stack">
    <div class="page-header">
      <div>
        <h2>Admin Dashboard</h2>
        <p class="muted">Local system visibility across bookings, users, and form submissions.</p>
      </div>
      <button
        type="button"
        class="btn btn--outline"
        :disabled="isLoading"
        @click="refreshDashboard"
      >
        Refresh
      </button>
    </div>

    <div v-if="errorMessage" class="app-alert app-alert--error" role="alert">
      <span>{{ errorMessage }}</span>
      <button type="button" class="btn btn--ghost" @click="fallbackError = ''">Dismiss</button>
    </div>

    <div class="admin-dashboard-grid">
      <AppCard title="Bookings" class="admin-dashboard-card">
        <div class="admin-dashboard-hero">
          <p class="admin-dashboard-hero__label">Total bookings</p>
          <p class="admin-dashboard-hero__value">{{ bookingTotal }}</p>
        </div>
        <div class="admin-dashboard-breakdown">
          <div class="admin-dashboard-breakdown__item">
            <p class="metric-label">Confirmed</p>
            <p class="metric-value">{{ bookingConfirmed }}</p>
          </div>
          <div class="admin-dashboard-breakdown__item">
            <p class="metric-label">Missed</p>
            <p class="metric-value">{{ bookingMissed }}</p>
          </div>
          <div class="admin-dashboard-breakdown__item">
            <p class="metric-label">Cancelled</p>
            <p class="metric-value">{{ bookingCancelled }}</p>
          </div>
          <div class="admin-dashboard-breakdown__item">
            <p class="metric-label">Completed</p>
            <p class="metric-value">{{ bookingCompleted }}</p>
          </div>
        </div>
      </AppCard>

      <AppCard title="Users" class="admin-dashboard-card">
        <div class="admin-dashboard-hero">
          <p class="admin-dashboard-hero__label">Total users</p>
          <p class="admin-dashboard-hero__value">{{ totalUsers }}</p>
        </div>
        <div class="admin-dashboard-breakdown">
          <div class="admin-dashboard-breakdown__item">
            <p class="metric-label">Photographers</p>
            <p class="metric-value">{{ photographerUsers }}</p>
          </div>
          <div class="admin-dashboard-breakdown__item">
            <p class="metric-label">Clients</p>
            <p class="metric-value">{{ clientUsers }}</p>
          </div>
        </div>
      </AppCard>

      <AppCard title="Forms" class="admin-dashboard-card">
        <div class="admin-dashboard-hero">
          <p class="admin-dashboard-hero__label">Submitted forms</p>
          <p class="admin-dashboard-hero__value">{{ submittedForms }}</p>
        </div>
        <div class="admin-dashboard-breakdown">
          <div class="admin-dashboard-breakdown__item">
            <p class="metric-label">Submission rate</p>
            <p class="metric-value">{{ formSubmissionRate }}</p>
          </div>
        </div>
      </AppCard>
    </div>
  </section>
</template>
