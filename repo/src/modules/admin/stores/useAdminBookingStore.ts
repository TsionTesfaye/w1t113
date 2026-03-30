import { getAuthService } from '@/app/providers/authProvider';
import { getBookingService } from '@/app/providers/bookingProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { BookingStatus } from '@/app/types/domain';
import type { BookingSlotView } from '@/services/BookingService';
import { defineStore } from 'pinia';

export interface AdminBookingItem {
  id: string;
  startTime: number;
  endTime: number;
  status: BookingStatus;
  serviceId: string;
  serviceName: string;
  clientId: string;
  clientUsername: string;
  photographerId: string;
  photographerName: string;
}

interface AdminBookingState {
  bookings: AdminBookingItem[];
  clients: Array<{ id: string; username: string }>;
  photographers: Array<{ id: string; username: string }>;
  services: Array<{
    id: string;
    name: string;
    durationMinutes: number;
    price: number;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
  }>;
  createDate: string;
  createSlots: BookingSlotView[];
  createSlotsLoading: boolean;
  loading: boolean;
  error: string;
}

function sortByStartTime(items: AdminBookingItem[]): AdminBookingItem[] {
  return [...items].sort((left, right) => left.startTime - right.startTime);
}

function getTodayDateKey(): string {
  const today = new Date();
  const year = String(today.getFullYear());
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const useAdminBookingStore = defineStore('admin-bookings', {
  state: (): AdminBookingState => ({
    bookings: [],
    clients: [],
    photographers: [],
    services: [],
    createDate: getTodayDateKey(),
    createSlots: [],
    createSlotsLoading: false,
    loading: false,
    error: ''
  }),

  actions: {
    resolveAdminId(): string {
      const authStore = useAuthStore();
      const adminId = authStore.currentUser?.id;
      if (!adminId) {
        throw new Error('Admin session required.');
      }

      return adminId;
    },

    async fetchAllBookings(): Promise<void> {
      this.loading = true;
      this.error = '';

      try {
        const adminId = this.resolveAdminId();
        const bookingService = getBookingService();
        const [bookings, services, users] = await Promise.all([
          bookingService.getAllBookings(adminId),
          bookingService.getServiceCatalog(adminId),
          getAuthService().getAllUsers(adminId)
        ]);

        const serviceNameById = new Map(services.map((service) => [service.id, service.name]));
        const usernameById = new Map(users.map((user) => [user.id, user.username]));
        this.services = services.map((service) => ({
          id: service.id,
          name: service.name,
          durationMinutes: service.durationMinutes,
          price: service.price ?? 0,
          isActive: service.isActive,
          createdAt: service.createdAt,
          updatedAt: service.updatedAt
        }));
        this.clients = users
          .filter((user) => user.role === 'client' && user.isActive)
          .map((user) => ({ id: user.id, username: user.username }))
          .sort((left, right) => left.username.localeCompare(right.username));
        this.photographers = users
          .filter((user) => user.role === 'photographer' && user.isActive)
          .map((user) => ({ id: user.id, username: user.username }))
          .sort((left, right) => left.username.localeCompare(right.username));

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
            photographerId: booking.photographerId,
            photographerName: usernameById.get(booking.photographerId) ?? booking.photographerId
          }))
        );
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : 'Unable to load bookings.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async createServiceItem(input: {
      name: string;
      durationMinutes: number;
      price?: number;
    }): Promise<void> {
      this.loading = true;
      this.error = '';

      try {
        const adminId = this.resolveAdminId();
        await getBookingService().createServiceItem(adminId, input);
        await this.fetchAllBookings();
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : 'Unable to create service.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async updateServiceItem(
      serviceId: string,
      input: { name: string; durationMinutes: number; price?: number }
    ): Promise<void> {
      this.loading = true;
      this.error = '';

      try {
        const adminId = this.resolveAdminId();
        await getBookingService().updateServiceItem(adminId, serviceId, input);
        await this.fetchAllBookings();
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : 'Unable to update service.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async archiveServiceItem(serviceId: string): Promise<void> {
      this.loading = true;
      this.error = '';

      try {
        const adminId = this.resolveAdminId();
        await getBookingService().archiveServiceItem(adminId, serviceId);
        await this.fetchAllBookings();
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : 'Unable to archive service.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async cancelBooking(bookingId: string): Promise<void> {
      this.loading = true;
      this.error = '';

      try {
        const adminId = this.resolveAdminId();
        const booking = await getBookingService().cancelBookingByAdmin(adminId, bookingId);
        const index = this.bookings.findIndex((item) => item.id === booking.id);
        if (index === -1) {
          await this.fetchAllBookings();
          return;
        }

        const nextBookings = [...this.bookings];
        const existing = nextBookings[index];
        if (!existing) {
          await this.fetchAllBookings();
          return;
        }

        nextBookings[index] = {
          ...existing,
          status: booking.status
        };
        this.bookings = sortByStartTime(nextBookings);
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : 'Unable to cancel booking.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async updateBookingStatus(bookingId: string, status: BookingStatus): Promise<void> {
      this.loading = true;
      this.error = '';

      try {
        const adminId = this.resolveAdminId();
        const booking = await getBookingService().updateBookingStatusByAdmin(adminId, bookingId, status);
        const index = this.bookings.findIndex((item) => item.id === booking.id);
        if (index === -1) {
          await this.fetchAllBookings();
          return;
        }

        const nextBookings = [...this.bookings];
        const existing = nextBookings[index];
        if (!existing) {
          await this.fetchAllBookings();
          return;
        }

        nextBookings[index] = {
          ...existing,
          status: booking.status
        };
        this.bookings = sortByStartTime(nextBookings);
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : 'Unable to update booking status.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async createBooking(input: {
      clientId: string;
      photographerId: string;
      serviceId: string;
      slotId: string;
    }): Promise<void> {
      this.loading = true;
      this.error = '';

      try {
        const adminId = this.resolveAdminId();
        await getBookingService().createBookingByAdmin(adminId, input);
        this.createSlots = this.createSlots.filter((slot) => slot.id !== input.slotId);
        await this.fetchAllBookings();
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : 'Unable to create booking.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async fetchCreateSlots(input: {
      serviceId: string;
      photographerId: string;
      date: string;
    }): Promise<void> {
      this.createDate = input.date;
      this.createSlots = [];
      this.error = '';

      if (!input.serviceId || !input.photographerId || !input.date) {
        return;
      }

      this.createSlotsLoading = true;
      try {
        const adminId = this.resolveAdminId();
        const slots = await getBookingService().getSlotsForAdmin(
          adminId,
          input.serviceId,
          input.date,
          input.photographerId
        );
        this.createSlots = slots.filter((slot) => slot.state === 'available');
      } catch (error: unknown) {
        this.error = error instanceof Error ? error.message : 'Unable to load available slots.';
        this.createSlots = [];
        throw error;
      } finally {
        this.createSlotsLoading = false;
      }
    }
  }
});
