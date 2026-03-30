<script setup lang="ts">
import AppCard from '@/components/AppCard.vue';
import { useHealthFormsStore } from '@/modules/healthForms/stores/useHealthFormsStore';
import {
  usePhotographerStore,
  type PhotographerBookingItem
} from '@/modules/photographer/stores/usePhotographerStore';
import type { BookingStatus } from '@/app/types/domain';
import { computed, onMounted, reactive } from 'vue';

const photographerStore = usePhotographerStore();
const formsStore = useHealthFormsStore();
const blockForm = reactive({
  startAt: '',
  endAt: ''
});
const formSummaryByBookingId = computed(
  () => new Map(formsStore.bookingForms.map((item) => [item.bookingId, item]))
);

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function statusClass(status: BookingStatus): string {
  if (status === 'completed' || status === 'auto_completed') {
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

function nextPhotographerStatus(status: BookingStatus): BookingStatus | null {
  if (status === 'pending') {
    return 'confirmed';
  }

  if (status === 'confirmed') {
    return 'arrived';
  }

  if (status === 'arrived') {
    return 'started';
  }

  if (status === 'started') {
    return 'completed';
  }

  return null;
}

function nextActionLabel(status: BookingStatus): string {
  if (status === 'pending') {
    return 'Confirm';
  }

  if (status === 'confirmed') {
    return 'Arrived';
  }

  if (status === 'arrived') {
    return 'Start';
  }

  if (status === 'started') {
    return 'Complete';
  }

  return 'No actions';
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

const now = computed(() => Date.now());
const todayStart = computed(() => startOfDay(now.value));
const todayEnd = computed(() => endOfDay(now.value));

const todayBookings = computed(() =>
  photographerStore.bookings.filter(
    (booking) => booking.startTime >= todayStart.value && booking.startTime <= todayEnd.value
  )
);

const upcomingBookings = computed(() =>
  photographerStore.bookings.filter((booking) => booking.startTime > todayEnd.value)
);

const pastBookings = computed(() =>
  photographerStore.bookings.filter((booking) => booking.endTime < todayStart.value)
);

async function updateStatus(booking: PhotographerBookingItem): Promise<void> {
  const nextStatus = nextPhotographerStatus(booking.status);
  if (!nextStatus) {
    return;
  }

  await photographerStore.updateBookingStatus(booking.id, nextStatus);
}

async function submitBlockAvailability(): Promise<void> {
  if (!blockForm.startAt || !blockForm.endAt) {
    photographerStore.error = 'Start and end time are required to block availability.';
    return;
  }

  const startTime = new Date(blockForm.startAt).getTime();
  const endTime = new Date(blockForm.endAt).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    photographerStore.error = 'Please provide a valid start and end time.';
    return;
  }

  await photographerStore.blockAvailability(startTime, endTime);
  blockForm.startAt = '';
  blockForm.endAt = '';
}

onMounted(() => {
  void photographerStore.fetchMyBookings();
  void formsStore.fetchAccessibleBookingForms();
});
</script>

<template>
  <section class="page-stack">
    <div class="page-header">
      <div>
        <h2>My Schedule</h2>
      </div>
    </div>

    <p v-if="photographerStore.error" class="form-error">{{ photographerStore.error }}</p>

    <AppCard title="Block availability">
      <div class="content-grid content-grid--2">
        <label class="field">
          <span class="field__label">Start</span>
          <input v-model="blockForm.startAt" type="datetime-local" class="input" />
        </label>
        <label class="field">
          <span class="field__label">End</span>
          <input v-model="blockForm.endAt" type="datetime-local" class="input" />
        </label>
      </div>
      <div class="actions-row">
        <button
          type="button"
          class="btn btn--primary"
          :disabled="photographerStore.loading"
          @click="submitBlockAvailability"
        >
          Block time
        </button>
      </div>
      <div v-if="photographerStore.blockedEntries.length > 0" class="booking-compact-list">
        <article
          v-for="entry in photographerStore.blockedEntries"
          :key="entry.id"
          class="booking-compact-row"
        >
          <div class="booking-compact-row__main">
            <strong>Blocked</strong>
            <span class="muted">
              {{ formatDate(entry.startTime) }} · {{ formatTime(entry.startTime) }} - {{ formatTime(entry.endTime) }}
            </span>
          </div>
          <span class="pill pill--warning">Blocked</span>
        </article>
      </div>
    </AppCard>

    <div v-if="photographerStore.loading && photographerStore.bookings.length === 0" class="empty-state">
      <p class="muted">Loading your bookings...</p>
    </div>

    <template v-else>
      <AppCard title="Today">
        <div v-if="todayBookings.length === 0" class="empty-state">
          <p class="muted">No bookings today.</p>
        </div>
        <div v-else class="booking-compact-list">
          <article v-for="booking in todayBookings" :key="booking.id" class="booking-compact-row">
            <div class="booking-compact-row__main">
              <strong>{{ booking.serviceName }}</strong>
              <span class="muted">{{ formatTime(booking.startTime) }} - {{ formatTime(booking.endTime) }}</span>
              <span class="muted">{{ booking.clientUsername }}</span>
            </div>
            <div class="booking-compact-row__actions">
              <span :class="statusClass(booking.status)">
                {{ formatStatus(booking.status) }}
              </span>
              <span
                class="pill"
                :class="`pill--booking-${formSummaryByBookingId.get(booking.id)?.formStatus ?? 'not_started'}`"
              >
                {{ formStatusLabel(formSummaryByBookingId.get(booking.id)?.formStatus ?? 'not_started') }}
              </span>
              <RouterLink
                v-if="formSummaryByBookingId.get(booking.id)?.canOpen"
                :to="`/forms/${booking.id}`"
                class="btn btn--ghost"
              >
                View response
              </RouterLink>
              <button
                type="button"
                class="btn btn--primary"
                :disabled="!nextPhotographerStatus(booking.status) || photographerStore.loading"
                @click="updateStatus(booking)"
              >
                {{ nextActionLabel(booking.status) }}
              </button>
            </div>
          </article>
        </div>
      </AppCard>

      <AppCard title="Upcoming">
        <div v-if="upcomingBookings.length === 0" class="empty-state">
          <p class="muted">No upcoming bookings.</p>
        </div>
        <div v-else class="booking-compact-list">
          <article v-for="booking in upcomingBookings" :key="booking.id" class="booking-compact-row">
            <div class="booking-compact-row__main">
              <strong>{{ booking.serviceName }}</strong>
              <span class="muted">{{ formatDate(booking.startTime) }} · {{ formatTime(booking.startTime) }} - {{ formatTime(booking.endTime) }}</span>
              <span class="muted">{{ booking.clientUsername }}</span>
            </div>
            <div class="booking-compact-row__actions">
              <span :class="statusClass(booking.status)">
                {{ formatStatus(booking.status) }}
              </span>
              <span
                class="pill"
                :class="`pill--booking-${formSummaryByBookingId.get(booking.id)?.formStatus ?? 'not_started'}`"
              >
                {{ formStatusLabel(formSummaryByBookingId.get(booking.id)?.formStatus ?? 'not_started') }}
              </span>
              <RouterLink
                v-if="formSummaryByBookingId.get(booking.id)?.canOpen"
                :to="`/forms/${booking.id}`"
                class="btn btn--ghost"
              >
                View response
              </RouterLink>
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
              <span class="muted">{{ formatDate(booking.startTime) }} · {{ formatTime(booking.startTime) }} - {{ formatTime(booking.endTime) }}</span>
              <span class="muted">{{ booking.clientUsername }}</span>
            </div>
            <div class="booking-compact-row__actions">
              <span :class="statusClass(booking.status)">
                {{ formatStatus(booking.status) }}
              </span>
              <span
                class="pill"
                :class="`pill--booking-${formSummaryByBookingId.get(booking.id)?.formStatus ?? 'not_started'}`"
              >
                {{ formStatusLabel(formSummaryByBookingId.get(booking.id)?.formStatus ?? 'not_started') }}
              </span>
              <RouterLink
                v-if="formSummaryByBookingId.get(booking.id)?.canOpen"
                :to="`/forms/${booking.id}`"
                class="btn btn--ghost"
              >
                View response
              </RouterLink>
            </div>
          </article>
        </div>
      </AppCard>
    </template>
  </section>
</template>
