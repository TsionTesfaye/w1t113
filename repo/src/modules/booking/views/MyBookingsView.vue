<script setup lang="ts">
import AppCard from '@/components/AppCard.vue';
import AppModal from '@/components/AppModal.vue';
import BookingTimeline from '@/modules/booking/components/BookingTimeline.vue';
import { useHealthFormsStore } from '@/modules/healthForms/stores/useHealthFormsStore';
import { useMyBookingsStore, type MyBookingItem } from '@/modules/booking/stores/useMyBookingsStore';
import type { BookingStatus } from '@/app/types/domain';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const myBookingsStore = useMyBookingsStore();
const formsStore = useHealthFormsStore();

const upcomingBookings = computed(() => myBookingsStore.upcoming);
const pastBookings = computed(() => myBookingsStore.past);

const detailBookingId = ref<string | null>(null);
const cancelBookingId = ref<string | null>(null);

const selectedDetailBooking = computed<MyBookingItem | null>(() => {
  if (!detailBookingId.value) {
    return null;
  }

  return myBookingsStore.bookings.find((booking) => booking.id === detailBookingId.value) ?? null;
});
const selectedDetailForm = computed(() => {
  if (!detailBookingId.value) {
    return null;
  }

  return formsStore.bookingForms.find((item) => item.bookingId === detailBookingId.value) ?? null;
});

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatStatus(status: BookingStatus): string {
  if (status === 'missed') {
    return 'Missed session';
  }

  if (status === 'auto_completed') {
    return 'Auto-completed';
  }

  if (status === 'photographer_unavailable') {
    return 'Photographer unavailable';
  }

  return status;
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

function statusClass(status: BookingStatus): string {
  if (status === 'confirmed' || status === 'completed' || status === 'auto_completed') {
    return 'pill pill--success';
  }

  if (status === 'canceled' || status === 'missed' || status === 'photographer_unavailable') {
    return 'pill pill--warning';
  }

  if (status === 'arrived' || status === 'started') {
    return 'pill pill--role-photographer';
  }

  return 'pill pill--role-client';
}

function openDetails(bookingId: string): void {
  detailBookingId.value = bookingId;
}

function closeDetails(): void {
  detailBookingId.value = null;
}

function requestCancel(bookingId: string): void {
  cancelBookingId.value = bookingId;
}

function closeCancelModal(): void {
  cancelBookingId.value = null;
}

async function confirmCancel(): Promise<void> {
  if (!cancelBookingId.value) {
    return;
  }

  try {
    await myBookingsStore.cancelBooking(cancelBookingId.value);
    closeCancelModal();
  } catch {
    // Store exposes user-facing error.
  }
}

async function openChat(bookingId: string): Promise<void> {
  try {
    const threadId = await myBookingsStore.openConversation(bookingId);
    await router.push(`/messages/${threadId}`);
  } catch {
    // Store exposes user-facing error.
  }
}

async function openHealthForm(bookingId: string): Promise<void> {
  await router.push(`/forms/${bookingId}`);
}

onMounted(() => {
  void myBookingsStore.fetchBookings();
  void formsStore.fetchAccessibleBookingForms();
});
</script>

<template>
  <section class="page-stack">
    <div class="page-header">
      <div>
        <h2>My Bookings</h2>
      </div>
    </div>

    <p v-if="myBookingsStore.errorMessage" class="form-error">{{ myBookingsStore.errorMessage }}</p>

    <AppCard title="Upcoming">
      <div v-if="myBookingsStore.loading && myBookingsStore.bookings.length === 0" class="empty-state">
        <p class="muted">Loading bookings...</p>
      </div>
      <div v-else-if="upcomingBookings.length === 0" class="empty-state">
        <p class="muted">No upcoming bookings.</p>
      </div>
      <div v-else class="booking-compact-list">
        <article v-for="booking in upcomingBookings" :key="booking.id" class="booking-compact-row">
          <div class="booking-compact-row__main">
            <strong>{{ booking.serviceName }}</strong>
            <span class="muted">
              {{ formatDateTime(booking.startTime) }} - {{ formatTime(booking.endTime) }}
            </span>
            <span class="muted">Photographer: {{ booking.photographerName }}</span>
          </div>
          <div class="booking-compact-row__actions">
            <span :class="statusClass(booking.status)">
              {{ formatStatus(booking.status) }}
            </span>
            <button type="button" class="btn btn--ghost" @click="openDetails(booking.id)">
              Details
            </button>
            <button type="button" class="btn btn--ghost" @click="openChat(booking.id)">
              Chat
            </button>
            <button
              v-if="myBookingsStore.canCancel(booking.status)"
              type="button"
              class="btn btn--outline"
              :disabled="myBookingsStore.loading"
              @click="requestCancel(booking.id)"
            >
              Cancel
            </button>
          </div>
        </article>
      </div>
    </AppCard>

    <AppCard title="Past">
      <div v-if="pastBookings.length === 0" class="empty-state">
        <p class="muted">No past bookings.</p>
      </div>
      <div v-else class="booking-compact-list">
        <article v-for="booking in pastBookings" :key="booking.id" class="booking-compact-row">
          <div class="booking-compact-row__main">
            <strong>{{ booking.serviceName }}</strong>
            <span class="muted">
              {{ formatDateTime(booking.startTime) }} - {{ formatTime(booking.endTime) }}
            </span>
            <span class="muted">Photographer: {{ booking.photographerName }}</span>
          </div>
          <div class="booking-compact-row__actions">
            <span :class="statusClass(booking.status)">
              {{ formatStatus(booking.status) }}
            </span>
            <button type="button" class="btn btn--ghost" @click="openDetails(booking.id)">
              Details
            </button>
            <button type="button" class="btn btn--ghost" @click="openChat(booking.id)">
              Chat
            </button>
          </div>
        </article>
      </div>
    </AppCard>
  </section>

  <AppModal
    :open="Boolean(detailBookingId)"
    title="Booking details"
    confirm-text="Close"
    cancel-text="Close"
    :confirm-variant="'primary'"
    @confirm="closeDetails"
    @cancel="closeDetails"
  >
    <template v-if="selectedDetailBooking">
      <p class="muted"><strong>Service:</strong> {{ selectedDetailBooking.serviceName }}</p>
      <p class="muted">
        <strong>Time:</strong>
        {{ formatDateTime(selectedDetailBooking.startTime) }} - {{ formatTime(selectedDetailBooking.endTime) }}
      </p>
      <p class="muted"><strong>Photographer:</strong> {{ selectedDetailBooking.photographerName }}</p>
      <p class="muted"><strong>Status:</strong> {{ formatStatus(selectedDetailBooking.status) }}</p>
      <BookingTimeline
        :status="selectedDetailBooking.status"
        :created-at="selectedDetailBooking.createdAt"
        :start-time="selectedDetailBooking.startTime"
        :end-time="selectedDetailBooking.endTime"
      />
      <div class="booking-detail-health-form">
        <p class="muted"><strong>Health Form:</strong></p>
        <div class="booking-detail-health-form__actions">
          <span
            class="pill"
            :class="`pill--booking-${selectedDetailForm?.formStatus ?? 'not_started'}`"
          >
            {{ formStatusLabel(selectedDetailForm?.formStatus ?? 'not_started') }}
          </span>
          <button
            v-if="selectedDetailForm?.canOpen"
            type="button"
            class="btn btn--ghost"
            @click="openHealthForm(selectedDetailBooking.id)"
          >
            View response
          </button>
        </div>
      </div>
    </template>
  </AppModal>

  <AppModal
    :open="Boolean(cancelBookingId)"
    title="Cancel booking"
    message="Do you want to cancel this booking?"
    confirm-text="Cancel booking"
    confirm-variant="danger"
    :loading="myBookingsStore.loading"
    @confirm="confirmCancel"
    @cancel="closeCancelModal"
  />
</template>
