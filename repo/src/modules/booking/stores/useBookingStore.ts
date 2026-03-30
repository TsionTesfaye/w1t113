import { getBookingService } from '@/app/providers/bookingProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { ServiceItem, SlotLock } from '@/app/types/domain';
import type { BookingSlotView } from '@/services/BookingService';
import { BookingServiceError } from '@/services/BookingService';
import { nowMs } from '@/services/timeSource';
import { defineStore } from 'pinia';

interface BookingState {
  services: ServiceItem[];
  selectedServiceId: string | null;
  selectedDate: string;
  slots: BookingSlotView[];
  activeLock: SlotLock | null;
  drawerOpen: boolean;
  isBusy: boolean;
  errorMessage: string;
  now: number;
  lockTickerId: number | null;
}

function getTodayDateKey(): string {
  const today = new Date(nowMs());
  const year = String(today.getFullYear());
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isPastDateKey(candidate: string, today: string): boolean {
  return candidate < today;
}

function toDateKeyFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const useBookingStore = defineStore('booking', {
  state: (): BookingState => ({
    services: [],
    selectedServiceId: null,
    selectedDate: getTodayDateKey(),
    slots: [],
    activeLock: null,
    drawerOpen: false,
    isBusy: false,
    errorMessage: '',
    now: nowMs(),
    lockTickerId: null
  }),

  getters: {
    selectedService(state): ServiceItem | null {
      return state.services.find((service) => service.id === state.selectedServiceId) ?? null;
    },

    minSelectableDate(): string {
      return getTodayDateKey();
    },

    activeLockSlot(state): BookingSlotView | null {
      if (!state.activeLock) {
        return null;
      }

      const slotFromTimeline = state.slots.find((slot) => slot.id === state.activeLock?.slotId);
      if (slotFromTimeline) {
        return slotFromTimeline;
      }

      return {
        id: state.activeLock.slotId,
        photographerId: state.activeLock.photographerId,
        startTime: state.activeLock.startTime,
        endTime: state.activeLock.endTime,
        isBooked: false,
        state: 'lockedBySelf',
        lockId: state.activeLock.id,
        lockExpiresAt: state.activeLock.expiresAt,
        lockOwnerUserId: state.activeLock.userId,
        isLockActive: true,
        isLockedByCurrentUser: true,
        isAvailable: true,
        availablePhotographerIds: [state.activeLock.photographerId]
      };
    },

    lockSecondsRemaining(state): number {
      if (!state.activeLock) {
        return 0;
      }

      return Math.max(0, Math.floor((state.activeLock.expiresAt - state.now) / 1000));
    },

    lockCountdownLabel(): string {
      const totalSeconds = this.lockSecondsRemaining;
      const minutes = Math.floor(totalSeconds / 60)
        .toString()
        .padStart(2, '0');
      const seconds = (totalSeconds % 60).toString().padStart(2, '0');
      return `${minutes}:${seconds}`;
    },

    canConfirm(): boolean {
      return Boolean(
        this.activeLock &&
        this.selectedServiceId &&
        this.lockSecondsRemaining > 0 &&
        this.activeLock.startTime > this.now
      );
    },

    lockedCount(state): number {
      return state.slots.filter((slot) => slot.state === 'lockedBySelf' || slot.state === 'lockedByOther').length;
    },

    availableCount(state): number {
      return state.slots.filter((slot) => slot.state === 'available').length;
    }
  },

  actions: {
    async initialize(): Promise<void> {
      const authStore = useAuthStore();
      if (!authStore.currentUser) {
        return;
      }

      this.isBusy = true;
      this.errorMessage = '';

      try {
        const bookingService = getBookingService();
        const services = await bookingService.getServices();
        this.services = services;

        if (!this.selectedServiceId || !services.some((service) => service.id === this.selectedServiceId)) {
          this.selectedServiceId = services[0]?.id ?? null;
        }

        await this.refreshSlots();
        await this.restoreActiveLock();
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to load booking data.';
      } finally {
        this.isBusy = false;
      }
    },

    async setSelectedService(serviceId: string): Promise<void> {
      this.selectedServiceId = serviceId;
      await this.refreshSlots();
      await this.restoreActiveLock();
    },

    async setSelectedDate(date: string): Promise<void> {
      const minDate = getTodayDateKey();
      if (isPastDateKey(date, minDate)) {
        this.selectedDate = minDate;
        this.errorMessage = 'Past dates are not allowed.';
        await this.refreshSlots();
        return;
      }

      this.selectedDate = date;
      await this.refreshSlots();
      await this.restoreActiveLock();
    },

    async refreshSlots(): Promise<void> {
      const authStore = useAuthStore();
      if (!authStore.currentUser || !this.selectedServiceId) {
        this.slots = [];
        return;
      }

      const bookingService = getBookingService();
      this.slots = await bookingService.getSlotsForDate(
        this.selectedServiceId,
        this.selectedDate,
        authStore.currentUser.id
      );

      if (this.activeLock && (this.activeLock.expiresAt <= nowMs() || this.activeLock.startTime <= nowMs())) {
        this.clearActiveLock();
      }
    },

    async selectSlot(slotId: string): Promise<void> {
      const authStore = useAuthStore();
      if (!authStore.currentUser || !this.selectedServiceId) {
        return;
      }

      this.errorMessage = '';
      this.isBusy = true;

      try {
        const bookingService = getBookingService();
        const lock = await bookingService.lockSlot(slotId, authStore.currentUser.id, this.selectedServiceId);
        this.activeLock = lock;
        this.drawerOpen = true;
        this.now = nowMs();
        this.startLockTicker();
        await this.refreshSlots();
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to lock selected slot.';
      } finally {
        this.isBusy = false;
      }
    },

    async confirmBooking(): Promise<void> {
      const authStore = useAuthStore();
      if (!authStore.currentUser || !this.activeLock || !this.selectedServiceId) {
        return;
      }

      this.errorMessage = '';
      this.isBusy = true;

      try {
        const bookingService = getBookingService();
        await bookingService.confirmBooking(
          this.activeLock.id,
          authStore.currentUser.id,
          this.selectedServiceId
        );

        this.clearActiveLock();
        await this.refreshSlots();
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to confirm booking.';
        if (
          error instanceof BookingServiceError &&
          (error.code === 'LOCK_EXPIRED' || error.code === 'SLOT_UNAVAILABLE')
        ) {
          await this.restoreActiveLock();
          await this.refreshSlots();
        }
      } finally {
        this.isBusy = false;
      }
    },

    async cancelLock(): Promise<void> {
      const authStore = useAuthStore();
      if (!authStore.currentUser || !this.activeLock) {
        this.clearActiveLock();
        return;
      }

      this.errorMessage = '';
      this.isBusy = true;

      try {
        await getBookingService().cancelLock(this.activeLock.id, authStore.currentUser.id);
        this.clearActiveLock();
        await this.refreshSlots();
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to cancel lock.';
      } finally {
        this.isBusy = false;
      }
    },

    async restoreActiveLock(): Promise<void> {
      const authStore = useAuthStore();
      if (!authStore.currentUser) {
        this.clearActiveLock();
        return;
      }

      const bookingService = getBookingService();
      const lock = await bookingService.getUserActiveLock(
        authStore.currentUser.id,
        authStore.currentUser.id
      );

      if (!lock || lock.expiresAt <= nowMs()) {
        this.clearActiveLock();
        return;
      }

      const lockDate = toDateKeyFromTimestamp(lock.startTime);
      if (lockDate !== this.selectedDate) {
        this.selectedDate = lockDate;
        await this.refreshSlots();
      }

      this.activeLock = lock;
      this.drawerOpen = true;
      this.now = nowMs();
      this.startLockTicker();
    },

    clearActiveLock(): void {
      this.activeLock = null;
      this.drawerOpen = false;
      this.stopLockTicker();
    },

    closeDrawer(): void {
      this.drawerOpen = false;
    },

    startLockTicker(): void {
      this.stopLockTicker();

      this.lockTickerId = window.setInterval(() => {
        this.now = nowMs();

        if (!this.activeLock) {
          this.stopLockTicker();
          return;
        }

        if (this.activeLock.expiresAt <= this.now) {
          this.clearActiveLock();
          void this.refreshSlots();
          return;
        }

        if (this.activeLock.startTime <= this.now) {
          this.clearActiveLock();
          void this.refreshSlots();
        }
      }, 1000);
    },

    stopLockTicker(): void {
      if (this.lockTickerId === null) {
        return;
      }

      window.clearInterval(this.lockTickerId);
      this.lockTickerId = null;
    }
  }
});
