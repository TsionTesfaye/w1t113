import type {
  Booking,
  BookingStatus,
  Photographer,
  ServiceItem,
  SlotLock
} from '@/app/types/domain';
import { indexedDbClient } from '@/db/indexedDbClient';
import { nowMs } from '@/services/timeSource';

export interface BookingRepository {
  getServices(): Promise<ServiceItem[]>;
  upsertServices(services: ServiceItem[]): Promise<void>;
  createServiceItem(service: ServiceItem): Promise<void>;
  updateServiceItem(service: ServiceItem): Promise<void>;
  archiveServiceItem(serviceId: string): Promise<ServiceItem | null>;
  getPhotographers(): Promise<Photographer[]>;
  getBookingsForDay(dayKey: string): Promise<Booking[]>;
  getAllBookings(): Promise<Booking[]>;
  getBookingsByPhotographer(photographerId: string): Promise<Booking[]>;
  getActiveLocksForDay(dayKey: string, now: number): Promise<SlotLock[]>;
  getAllLocks(): Promise<SlotLock[]>;
  getUserLock(lockId: string, userId: string, now: number): Promise<SlotLock | null>;
  getActiveLockByUser(userId: string, now: number): Promise<SlotLock | null>;
  createLock(lock: SlotLock, now: number): Promise<SlotLock | null>;
  deleteUserLock(lockId: string, userId: string): Promise<boolean>;
  deleteLocksForPhotographerRange(
    photographerId: string,
    startTime: number,
    endTime: number
  ): Promise<number>;
  deleteLocksForPhotographer(photographerId: string): Promise<number>;
  deleteExpiredLocks(now: number): Promise<number>;
  confirmLockAndCreateBooking(
    lockId: string,
    userId: string,
    booking: Booking,
    now: number
  ): Promise<Booking | null>;
  createBookingDirect(booking: Booking, now: number): Promise<Booking | null>;
  getBookingById(bookingId: string): Promise<Booking | null>;
  getBookingsByUser(userId: string): Promise<Booking[]>;
  updateBookingStatus(bookingId: string, status: BookingStatus): Promise<Booking>;
}

function isActiveLock(lock: SlotLock, now: number): boolean {
  return lock.expiresAt > now;
}

function hasBookingRange(booking: Booking): boolean {
  return Number.isFinite(booking.startTime) && Number.isFinite(booking.endTime);
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function sortBookings(bookings: Booking[]): Booking[] {
  return [...bookings].sort((left, right) => right.createdAt - left.createdAt);
}

function sortBookingsByStartTime(bookings: Booking[]): Booking[] {
  return [...bookings].sort((left, right) => left.startTime - right.startTime);
}

interface UserRecord {
  id: string;
  username: string;
  role: string;
  isActive?: boolean;
}

function isActivePhotographerUser(user: UserRecord | undefined): user is UserRecord {
  return Boolean(user && user.role === 'photographer' && user.isActive !== false);
}

function toPhotographer(user: UserRecord): Photographer {
  return {
    id: user.id,
    name: user.username?.trim() || user.id,
    isActive: user.isActive !== false
  };
}

class IndexedDbBookingRepository implements BookingRepository {
  private normalizeServiceItem(
    service: ServiceItem | (Partial<ServiceItem> & { id: string; name: string; durationMinutes: number })
  ): ServiceItem {
    const now = nowMs();
    return {
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
      price: typeof service.price === 'number' ? service.price : 0,
      isActive: service.isActive !== false,
      createdAt: typeof service.createdAt === 'number' ? service.createdAt : now,
      updatedAt: typeof service.updatedAt === 'number' ? service.updatedAt : now
    };
  }

  async getServices(): Promise<ServiceItem[]> {
    return indexedDbClient.withTransaction(['serviceItems'], 'readonly', async (transaction) => {
      const services = await transaction.getAll<
        ServiceItem | (Partial<ServiceItem> & { id: string; name: string; durationMinutes: number })
      >('serviceItems');
      return services.map((service) => this.normalizeServiceItem(service));
    });
  }

  async upsertServices(services: ServiceItem[]): Promise<void> {
    await indexedDbClient.withTransaction(['serviceItems'], 'readwrite', async (transaction) => {
      for (const service of services) {
        await transaction.put('serviceItems', this.normalizeServiceItem(service));
      }
    });
  }

  async createServiceItem(service: ServiceItem): Promise<void> {
    await indexedDbClient.withTransaction(['serviceItems'], 'readwrite', async (transaction) => {
      await transaction.put('serviceItems', this.normalizeServiceItem(service));
    });
  }

  async updateServiceItem(service: ServiceItem): Promise<void> {
    await indexedDbClient.withTransaction(['serviceItems'], 'readwrite', async (transaction) => {
      const existing = await transaction.get<ServiceItem>('serviceItems', service.id);
      if (!existing) {
        throw new Error('SERVICE_NOT_FOUND');
      }

      await transaction.put('serviceItems', this.normalizeServiceItem(service));
    });
  }

  async archiveServiceItem(serviceId: string): Promise<ServiceItem | null> {
    return indexedDbClient.withTransaction(['serviceItems'], 'readwrite', async (transaction) => {
      const existing = await transaction.get<ServiceItem>('serviceItems', serviceId);
      if (!existing) {
        return null;
      }

      const archived = this.normalizeServiceItem({
        ...existing,
        isActive: false,
        updatedAt: nowMs()
      });
      await transaction.put('serviceItems', archived);
      return archived;
    });
  }

  async getPhotographers(): Promise<Photographer[]> {
    return indexedDbClient.withTransaction(['users'], 'readonly', async (transaction) => {
      const photographerUsers = await transaction.getAllByIndex<UserRecord>(
        'users',
        'role',
        'photographer'
      );

      return photographerUsers
        .filter((user) => user.isActive !== false)
        .map((user) => toPhotographer(user));
    });
  }

  async getBookingsForDay(dayKey: string): Promise<Booking[]> {
    return indexedDbClient.withTransaction(['bookings'], 'readonly', async (transaction) => {
      const bookings = await transaction.getAllByIndex<Booking>('bookings', 'dayKey', dayKey);
      return bookings;
    });
  }

  async getAllBookings(): Promise<Booking[]> {
    return indexedDbClient.withTransaction(['bookings'], 'readonly', async (transaction) => {
      const bookings = await transaction.getAll<Booking>('bookings');
      return sortBookingsByStartTime(bookings);
    });
  }

  async getBookingsByPhotographer(photographerId: string): Promise<Booking[]> {
    return indexedDbClient.withTransaction(['bookings'], 'readonly', async (transaction) => {
      const bookings = await transaction.getAllByIndex<Booking>(
        'bookings',
        'photographerId',
        photographerId
      );
      return sortBookingsByStartTime(bookings);
    });
  }

  async getActiveLocksForDay(dayKey: string, now: number): Promise<SlotLock[]> {
    return indexedDbClient.withTransaction(['slotLocks'], 'readonly', async (transaction) => {
      const locks = await transaction.getAllByIndex<SlotLock>('slotLocks', 'dayKey', dayKey);
      return locks.filter((lock) => isActiveLock(lock, now));
    });
  }

  async getAllLocks(): Promise<SlotLock[]> {
    return indexedDbClient.withTransaction(['slotLocks'], 'readonly', async (transaction) => {
      return transaction.getAll<SlotLock>('slotLocks');
    });
  }

  async getUserLock(lockId: string, userId: string, now: number): Promise<SlotLock | null> {
    return indexedDbClient.withTransaction(['slotLocks'], 'readonly', async (transaction) => {
      const lock = await transaction.get<SlotLock>('slotLocks', lockId);
      if (!lock || lock.userId !== userId || !isActiveLock(lock, now)) {
        return null;
      }

      return lock;
    });
  }

  async getActiveLockByUser(userId: string, now: number): Promise<SlotLock | null> {
    return indexedDbClient.withTransaction(['slotLocks'], 'readonly', async (transaction) => {
      const locks = await transaction.getAllByIndex<SlotLock>('slotLocks', 'userId', userId);
      const activeLocks = locks
        .filter((lock) => isActiveLock(lock, now))
        .sort((left, right) => right.expiresAt - left.expiresAt);
      return activeLocks[0] ?? null;
    });
  }

  async createLock(lock: SlotLock, now: number): Promise<SlotLock | null> {
    return indexedDbClient.withTransaction(
      ['slotLocks', 'bookings', 'users'],
      'readwrite',
      async (transaction) => {
        if (lock.startTime < now || lock.endTime <= lock.startTime) {
          return null;
        }

        const photographerUser = await transaction.get<UserRecord>('users', lock.photographerId);
        if (!isActivePhotographerUser(photographerUser)) {
          return null;
        }

        const existingLocks = await transaction.getAll<SlotLock>('slotLocks');
        const activeLocks: SlotLock[] = [];

        for (const existingLock of existingLocks) {
          if (!isActiveLock(existingLock, now)) {
            await transaction.delete('slotLocks', existingLock.id);
            continue;
          }

          activeLocks.push(existingLock);
        }

        const hasAnotherUserActiveLock = activeLocks.some((activeLock) => {
          return activeLock.userId === lock.userId && activeLock.id !== lock.id;
        });
        if (hasAnotherUserActiveLock) {
          return null;
        }

        const photographerLockConflict = activeLocks.some((activeLock) => {
          return (
            activeLock.id !== lock.id &&
            activeLock.photographerId === lock.photographerId &&
            overlaps(lock.startTime, lock.endTime, activeLock.startTime, activeLock.endTime)
          );
        });
        if (photographerLockConflict) {
          return null;
        }

        const bookings = await transaction.getAll<Booking>('bookings');
        const photographerBookingConflict = bookings.some((booking) => {
          if (
            booking.status === 'canceled' ||
            booking.photographerId !== lock.photographerId ||
            !hasBookingRange(booking)
          ) {
            return false;
          }

          return overlaps(lock.startTime, lock.endTime, booking.startTime, booking.endTime);
        });
        if (photographerBookingConflict) {
          return null;
        }

        await transaction.put('slotLocks', lock);
        return lock;
      }
    );
  }

  async deleteUserLock(lockId: string, userId: string): Promise<boolean> {
    return indexedDbClient.withTransaction(['slotLocks'], 'readwrite', async (transaction) => {
      const lock = await transaction.get<SlotLock>('slotLocks', lockId);
      if (!lock || lock.userId !== userId) {
        return false;
      }

      await transaction.delete('slotLocks', lockId);
      return true;
    });
  }

  async deleteExpiredLocks(now: number): Promise<number> {
    return indexedDbClient.withTransaction(['slotLocks'], 'readwrite', async (transaction) => {
      const locks = await transaction.getAll<SlotLock>('slotLocks');
      let deleted = 0;

      for (const lock of locks) {
        if (!isActiveLock(lock, now)) {
          deleted += 1;
          await transaction.delete('slotLocks', lock.id);
        }
      }

      return deleted;
    });
  }

  async deleteLocksForPhotographerRange(
    photographerId: string,
    startTime: number,
    endTime: number
  ): Promise<number> {
    return indexedDbClient.withTransaction(['slotLocks'], 'readwrite', async (transaction) => {
      const locks = await transaction.getAllByIndex<SlotLock>('slotLocks', 'photographerId', photographerId);
      let deleted = 0;

      for (const lock of locks) {
        if (overlaps(startTime, endTime, lock.startTime, lock.endTime)) {
          await transaction.delete('slotLocks', lock.id);
          deleted += 1;
        }
      }

      return deleted;
    });
  }

  async deleteLocksForPhotographer(photographerId: string): Promise<number> {
    return indexedDbClient.withTransaction(['slotLocks'], 'readwrite', async (transaction) => {
      const locks = await transaction.getAllByIndex<SlotLock>('slotLocks', 'photographerId', photographerId);
      let deleted = 0;

      for (const lock of locks) {
        await transaction.delete('slotLocks', lock.id);
        deleted += 1;
      }

      return deleted;
    });
  }

  async confirmLockAndCreateBooking(
    lockId: string,
    userId: string,
    booking: Booking,
    now: number
  ): Promise<Booking | null> {
    return indexedDbClient.withTransaction(
      ['slotLocks', 'bookings', 'users'],
      'readwrite',
      async (transaction) => {
        if (booking.startTime < now || booking.endTime <= booking.startTime) {
          return null;
        }

        const lock = await transaction.get<SlotLock>('slotLocks', lockId);
        if (!lock || lock.userId !== userId || !isActiveLock(lock, now)) {
          return null;
        }

        if (
          lock.startTime !== booking.startTime ||
          lock.endTime !== booking.endTime
        ) {
          return null;
        }

        const photographerUser = await transaction.get<UserRecord>('users', booking.photographerId);
        if (!isActivePhotographerUser(photographerUser)) {
          return null;
        }

        const locks = await transaction.getAll<SlotLock>('slotLocks');
        const overlappingActiveLock = locks.some((existingLock) => {
          return (
            existingLock.id !== lock.id &&
            isActiveLock(existingLock, now) &&
            existingLock.photographerId === booking.photographerId &&
            overlaps(booking.startTime, booking.endTime, existingLock.startTime, existingLock.endTime)
          );
        });
        if (overlappingActiveLock) {
          return null;
        }

        const bookings = await transaction.getAll<Booking>('bookings');
        const photographerBookingConflict = bookings.some((existingBooking) => {
          if (
            existingBooking.status === 'canceled' ||
            existingBooking.photographerId !== booking.photographerId ||
            !hasBookingRange(existingBooking)
          ) {
            return false;
          }

          return overlaps(
            booking.startTime,
            booking.endTime,
            existingBooking.startTime,
            existingBooking.endTime
          );
        });
        if (photographerBookingConflict) {
          return null;
        }

        await transaction.put('bookings', booking);
        await transaction.delete('slotLocks', lock.id);
        return booking;
      }
    );
  }

  async createBookingDirect(booking: Booking, now: number): Promise<Booking | null> {
    return indexedDbClient.withTransaction(
      ['bookings', 'slotLocks', 'users'],
      'readwrite',
      async (transaction) => {
        if (booking.startTime < now || booking.endTime <= booking.startTime) {
          return null;
        }

        const photographerUser = await transaction.get<UserRecord>('users', booking.photographerId);
        if (!isActivePhotographerUser(photographerUser)) {
          return null;
        }

        const locks = await transaction.getAll<SlotLock>('slotLocks');
        const overlappingActiveLock = locks.some((existingLock) => {
          return (
            isActiveLock(existingLock, now) &&
            existingLock.photographerId === booking.photographerId &&
            overlaps(booking.startTime, booking.endTime, existingLock.startTime, existingLock.endTime)
          );
        });
        if (overlappingActiveLock) {
          return null;
        }

        const bookings = await transaction.getAll<Booking>('bookings');
        const photographerBookingConflict = bookings.some((existingBooking) => {
          if (
            existingBooking.status === 'canceled' ||
            existingBooking.photographerId !== booking.photographerId ||
            !hasBookingRange(existingBooking)
          ) {
            return false;
          }

          return overlaps(
            booking.startTime,
            booking.endTime,
            existingBooking.startTime,
            existingBooking.endTime
          );
        });
        if (photographerBookingConflict) {
          return null;
        }

        await transaction.put('bookings', booking);
        return booking;
      }
    );
  }

  async getBookingById(bookingId: string): Promise<Booking | null> {
    return indexedDbClient.withTransaction(['bookings'], 'readonly', async (transaction) => {
      const booking = await transaction.get<Booking>('bookings', bookingId);
      return booking ?? null;
    });
  }

  async getBookingsByUser(userId: string): Promise<Booking[]> {
    return indexedDbClient.withTransaction(['bookings'], 'readonly', async (transaction) => {
      const bookings = await transaction.getAllByIndex<Booking>('bookings', 'userId', userId);
      return sortBookings(bookings);
    });
  }

  async updateBookingStatus(bookingId: string, status: BookingStatus): Promise<Booking> {
    return indexedDbClient.withTransaction(['bookings'], 'readwrite', async (transaction) => {
      const booking = await transaction.get<Booking>('bookings', bookingId);
      if (!booking) {
        throw new Error('BOOKING_NOT_FOUND');
      }

      const updatedBooking: Booking = {
        ...booking,
        status
      };
      await transaction.put('bookings', updatedBooking);
      return updatedBooking;
    });
  }
}

export function createBookingRepository(): BookingRepository {
  return new IndexedDbBookingRepository();
}
