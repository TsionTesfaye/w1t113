import { getAuthService } from '@/app/providers/authProvider';
import { getBookingService } from '@/app/providers/bookingProvider';
import { getMessageService } from '@/app/providers/messagingProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { BookingStatus } from '@/app/types/domain';
import { defineStore } from 'pinia';

export interface MyBookingItem {
  id: string;
  serviceId: string;
  serviceName: string;
  photographerId: string;
  photographerName: string;
  startTime: number;
  endTime: number;
  createdAt: number;
  status: BookingStatus;
}

interface MyBookingsState {
  bookings: MyBookingItem[];
  loading: boolean;
  errorMessage: string;
}

function sortByStartTime(items: MyBookingItem[]): MyBookingItem[] {
  return [...items].sort((left, right) => left.startTime - right.startTime);
}

function canCancelStatus(status: BookingStatus): boolean {
  return (
    status === 'pending' ||
    status === 'confirmed' ||
    status === 'rescheduled' ||
    status === 'photographer_unavailable'
  );
}

export const useMyBookingsStore = defineStore('my-bookings', {
  state: (): MyBookingsState => ({
    bookings: [],
    loading: false,
    errorMessage: ''
  }),

  getters: {
    upcoming(state): MyBookingItem[] {
      const now = Date.now();
      return state.bookings.filter((booking) => booking.endTime >= now);
    },

    past(state): MyBookingItem[] {
      const now = Date.now();
      return state.bookings.filter((booking) => booking.endTime < now);
    }
  },

  actions: {
    resolveUserId(): string {
      const authStore = useAuthStore();
      const userId = authStore.currentUser?.id;
      if (!userId) {
        throw new Error('Client session required.');
      }

      return userId;
    },

    async fetchBookings(): Promise<void> {
      this.loading = true;
      this.errorMessage = '';

      try {
        const userId = this.resolveUserId();
        const [bookings, services] = await Promise.all([
          getBookingService().getBookingsForUser(userId, userId),
          getBookingService().getServices()
        ]);
        const photographerIds = [...new Set(bookings.map((booking) => booking.photographerId))];
        const photographers = await getAuthService().getUsersByIds(userId, photographerIds);

        const serviceNameById = new Map(services.map((service) => [service.id, service.name]));
        const usernameById = new Map(photographers.map((user) => [user.id, user.username]));

        this.bookings = sortByStartTime(
          bookings.map((booking) => ({
            id: booking.id,
            serviceId: booking.serviceId,
            serviceName: serviceNameById.get(booking.serviceId) ?? booking.serviceId,
            photographerId: booking.photographerId,
            photographerName: usernameById.get(booking.photographerId) ?? booking.photographerId,
            startTime: booking.startTime,
            endTime: booking.endTime,
            createdAt: booking.createdAt,
            status: booking.status
          }))
        );
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to load bookings.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    canCancel(status: BookingStatus): boolean {
      return canCancelStatus(status);
    },

    async cancelBooking(bookingId: string): Promise<void> {
      this.loading = true;
      this.errorMessage = '';

      try {
        const userId = this.resolveUserId();
        const updated = await getBookingService().cancelBookingByUser(userId, bookingId);
        const index = this.bookings.findIndex((booking) => booking.id === updated.id);
        if (index === -1) {
          await this.fetchBookings();
          return;
        }

        const nextBookings = [...this.bookings];
        const existing = nextBookings[index];
        if (!existing) {
          await this.fetchBookings();
          return;
        }

        nextBookings[index] = {
          ...existing,
          status: updated.status
        };
        this.bookings = sortByStartTime(nextBookings);
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to cancel booking.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async openConversation(bookingId: string): Promise<string> {
      this.errorMessage = '';
      try {
        const thread = await getMessageService().getOrCreateThread(bookingId);
        return thread.id;
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to open booking conversation.';
        throw error;
      }
    }
  }
});
