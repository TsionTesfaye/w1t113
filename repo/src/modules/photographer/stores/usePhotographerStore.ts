import { getAuthService } from '@/app/providers/authProvider';
import { getBookingService } from '@/app/providers/bookingProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { BookingStatus } from '@/app/types/domain';
import { defineStore } from 'pinia';

export interface PhotographerBookingItem {
  id: string;
  startTime: number;
  endTime: number;
  status: BookingStatus;
  serviceId: string;
  serviceName: string;
  clientId: string;
  clientUsername: string;
  photographerId: string;
}

export interface PhotographerBlockedItem {
  id: string;
  startTime: number;
  endTime: number;
}

interface PhotographerState {
  bookings: PhotographerBookingItem[];
  blockedEntries: PhotographerBlockedItem[];
  loading: boolean;
  error: string;
}

function sortByStartTime(items: PhotographerBookingItem[]): PhotographerBookingItem[] {
  return [...items].sort((left, right) => left.startTime - right.startTime);
}

export const usePhotographerStore = defineStore('photographer', {
  state: (): PhotographerState => ({
    bookings: [],
    blockedEntries: [],
    loading: false,
    error: ''
  }),

  actions: {
    resolveCurrentUserId(): string {
      const authStore = useAuthStore();
      const userId = authStore.currentUser?.id;
      if (!userId) {
        throw new Error('Sign in required.');
      }

      return userId;
    },

    async fetchMyBookings(): Promise<void> {
      this.loading = true;
      this.error = '';

      try {
        const userId = this.resolveCurrentUserId();
        const bookingService = getBookingService();
        const [bookings, services] = await Promise.all([
          bookingService.getBookingsForPhotographer(userId),
          bookingService.getServices()
        ]);
        const blockedEntries = await bookingService.getBlockedAvailabilityForPhotographer(userId);
        const clientIds = [...new Set(bookings.map((booking) => booking.userId))];
        const clients = await getAuthService().getUsersByIds(userId, clientIds);

        const serviceNameById = new Map(services.map((service) => [service.id, service.name]));
        const usernameById = new Map(clients.map((user) => [user.id, user.username]));

        this.bookings = sortByStartTime(
          bookings.map((booking) => ({
            id: booking.id,
            startTime: booking.startTime,
            endTime: booking.endTime,
            status: booking.status,
            serviceId: booking.serviceId,
            serviceName: serviceNameById.get(booking.serviceId) ?? booking.serviceId,
            clientId: booking.userId,
            clientUsername: usernameById.get(booking.userId) ?? booking.userId,
            photographerId: booking.photographerId
          }))
        );
        this.blockedEntries = blockedEntries
          .map((entry) => ({
            id: entry.id,
            startTime: entry.startTime,
            endTime: entry.endTime
          }))
          .sort((left, right) => left.startTime - right.startTime);
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : 'Unable to load photographer bookings.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async updateBookingStatus(bookingId: string, status: BookingStatus): Promise<void> {
      this.loading = true;
      this.error = '';

      try {
        const userId = this.resolveCurrentUserId();
        const updatedBooking = await getBookingService().updateBookingStatus(userId, bookingId, status);
        const index = this.bookings.findIndex((booking) => booking.id === updatedBooking.id);
        if (index === -1) {
          await this.fetchMyBookings();
          return;
        }

        const nextBookings = [...this.bookings];
        const existing = nextBookings[index];
        if (!existing) {
          await this.fetchMyBookings();
          return;
        }

        nextBookings[index] = {
          ...existing,
          status: updatedBooking.status
        };
        this.bookings = sortByStartTime(nextBookings);
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : 'Unable to update booking status.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async blockAvailability(startTime: number, endTime: number): Promise<void> {
      this.loading = true;
      this.error = '';

      try {
        const userId = this.resolveCurrentUserId();
        await getBookingService().blockPhotographerAvailability(userId, {
          startTime,
          endTime
        });
        await this.fetchMyBookings();
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : 'Unable to block availability.';
        throw error;
      } finally {
        this.loading = false;
      }
    }
  }
});
