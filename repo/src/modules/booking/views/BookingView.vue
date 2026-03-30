<script setup lang="ts">
import AppCard from '@/components/AppCard.vue';
import { useAuthStore } from '@/app/stores/useAuthStore';
import { useBookingStore } from '@/modules/booking/stores/useBookingStore';
import type { BookingSlotView } from '@/services/BookingService';
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';

const authStore = useAuthStore();
const bookingStore = useBookingStore();

const selectedService = computed(() => bookingStore.selectedService);
const activeLock = computed(() => bookingStore.activeLock);
const activeLockSlot = computed(() => bookingStore.activeLockSlot);
const activeLockDurationMinutes = computed(() => {
  if (!activeLockSlot.value) {
    return 0;
  }

  return Math.round((activeLockSlot.value.endTime - activeLockSlot.value.startTime) / (60 * 1000));
});

const todayDateKey = computed(() => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
});

const showTodayExhaustedState = computed(() => {
  if (bookingStore.selectedDate !== todayDateKey.value) {
    return false;
  }

  const now = Date.now();
  if (bookingStore.slots.length > 0) {
    return bookingStore.slots.every((slot) => slot.endTime <= now);
  }

  const todayAtClose = new Date();
  todayAtClose.setHours(17, 0, 0, 0);
  return now >= todayAtClose.getTime();
});

const dateValue = computed({
  get: () => bookingStore.selectedDate,
  set: (value: string) => {
    void bookingStore.setSelectedDate(value);
  }
});

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateTimeRange(startTime: number, endTime: number): string {
  const start = new Date(startTime).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${start} - ${formatTime(endTime)}`;
}

function slotRangeLabel(slot: BookingSlotView): string {
  return `${formatTime(slot.startTime)} - ${formatTime(slot.endTime)}`;
}

function slotStateLabel(slot: BookingSlotView): string {
  switch (slot.state) {
    case 'available':
      return `${slot.availablePhotographerIds.length} photographer${
        slot.availablePhotographerIds.length === 1 ? '' : 's'
      } available`;
    case 'booked':
      return 'Fully booked';
    case 'lockedBySelf':
      return 'Held by you';
    case 'lockedByOther':
      return 'Temporarily held';
    case 'unavailable':
      return 'Not available';
    default:
      return 'Not available';
  }
}

function isSlotDisabled(slot: BookingSlotView): boolean {
  if (bookingStore.isBusy) {
    return true;
  }

  return slot.state !== 'available' && slot.state !== 'lockedBySelf';
}

onMounted(() => {
  if (authStore.currentUser) {
    void bookingStore.initialize();
  }
});

watch(
  () => authStore.currentUser?.id,
  (userId, previousUserId) => {
    if (!userId || userId === previousUserId) {
      return;
    }

    void bookingStore.initialize();
  }
);

onBeforeUnmount(() => {
  bookingStore.stopLockTicker();
});
</script>

<template>
  <section class="page-stack">
    <div class="page-header">
      <div>
        <h2>Book Session</h2>
      </div>
      <div class="booking-countdown-badge" :class="{ 'is-active': bookingStore.drawerOpen }">
        <span v-if="bookingStore.drawerOpen">Hold: {{ bookingStore.lockCountdownLabel }}</span>
        <span v-else>No hold</span>
      </div>
    </div>

    <div class="booking-inline-summary">
      {{ bookingStore.availableCount }} slots · {{ bookingStore.lockedCount }} holds
    </div>

    <AppCard title="Service">
      <div class="service-card-grid">
        <button
          v-for="service in bookingStore.services"
          :key="service.id"
          type="button"
          class="service-card"
          :class="{ 'is-selected': bookingStore.selectedServiceId === service.id }"
          @click="bookingStore.setSelectedService(service.id)"
        >
          <div>
            <p class="service-card__name">{{ service.name }}</p>
            <p class="service-card__meta">{{ service.durationMinutes }} minutes</p>
          </div>
          <p class="service-card__price">{{ formatCurrency(service.price ?? 0) }}</p>
        </button>
      </div>
    </AppCard>

    <div class="content-grid content-grid--2">
      <AppCard title="Time">
        <div class="slot-controls">
          <label class="field">
            <span class="field__label">Session Date</span>
            <input v-model="dateValue" type="date" class="input" :min="bookingStore.minSelectableDate" />
          </label>
          <div class="slot-controls__summary" v-if="selectedService">
            <p class="muted">Session duration: <strong>{{ selectedService.durationMinutes }} minutes</strong></p>
            <p class="muted">Lunch excluded</p>
          </div>
        </div>

        <p v-if="bookingStore.errorMessage" class="form-error">{{ bookingStore.errorMessage }}</p>

        <div v-if="showTodayExhaustedState" class="slot-empty-state">
          <p class="slot-empty-state__title">No remaining slots today</p>
          <p class="slot-empty-state__subtitle">Please select another date</p>
        </div>

        <div v-else class="slot-grid">
          <button
            v-for="slot in bookingStore.slots"
            :key="slot.id"
            type="button"
            class="slot-chip"
            :class="{
              'is-available': slot.state === 'available',
              'is-booked': slot.state === 'booked',
              'is-locked': slot.state === 'lockedByOther',
              'is-owned': slot.state === 'lockedBySelf',
              'is-unavailable': slot.state === 'unavailable',
              'is-disabled': isSlotDisabled(slot)
            }"
            :disabled="isSlotDisabled(slot)"
            @click="bookingStore.selectSlot(slot.id)"
          >
            <strong>{{ slotRangeLabel(slot) }}</strong>
            <small>{{ slotStateLabel(slot) }}</small>
          </button>
        </div>
        <div v-if="!showTodayExhaustedState && bookingStore.slots.length === 0" class="slot-empty-state">
          <p class="slot-empty-state__title">No slots available for this date</p>
          <p class="slot-empty-state__subtitle">Try a different date or service</p>
        </div>
      </AppCard>

      <AppCard title="Selection">
        <div class="empty-state">
          <p class="muted">Choose a service and start time, then confirm in the drawer.</p>
        </div>
      </AppCard>
    </div>

    <div class="booking-drawer-overlay" v-if="bookingStore.drawerOpen" @click="bookingStore.closeDrawer" />
    <aside class="booking-drawer" :class="{ 'is-open': bookingStore.drawerOpen }" aria-live="polite">
      <div class="booking-drawer__header">
        <h3>Confirm Booking</h3>
        <button type="button" class="btn btn--ghost" @click="bookingStore.closeDrawer">Close</button>
      </div>

      <div class="booking-drawer__body" v-if="activeLock && activeLockSlot && selectedService">
        <div class="drawer-summary">
          <p class="metric-label">Service</p>
          <p class="drawer-summary__value">{{ selectedService.name }}</p>
        </div>
        <div class="drawer-summary">
          <p class="metric-label">Time</p>
          <p class="drawer-summary__value">
            {{ formatDateTimeRange(activeLockSlot.startTime, activeLockSlot.endTime) }}
          </p>
        </div>
        <div class="drawer-summary">
          <p class="metric-label">Duration</p>
          <p class="drawer-summary__value">{{ activeLockDurationMinutes }} minutes</p>
        </div>
        <div class="drawer-summary drawer-summary--countdown">
          <p class="metric-label">Lock Expires In</p>
          <p class="drawer-summary__countdown">{{ bookingStore.lockCountdownLabel }}</p>
        </div>
      </div>

      <div class="booking-drawer__actions">
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!bookingStore.canConfirm || bookingStore.isBusy"
          @click="bookingStore.confirmBooking"
        >
          Confirm
        </button>
        <button
          type="button"
          class="btn btn--outline"
          :disabled="bookingStore.isBusy"
          @click="bookingStore.cancelLock"
        >
          Cancel
        </button>
      </div>
    </aside>
  </section>
</template>
