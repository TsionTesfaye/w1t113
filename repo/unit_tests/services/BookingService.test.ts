import type { AuthenticatedUser, Booking, BookingStatus, Photographer, ServiceItem, SlotLock } from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { BookingRepository } from '@/repositories/BookingRepository';
import { BookingServiceError, createBookingService } from '@/services/BookingService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SERVICE_ID = 'service-headshots-30';
const USER_1 = 'client-1';
const USER_2 = 'client-2';
const PHOTOGRAPHER_ID = 'photographer-1';

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

class InMemoryBookingRepository implements BookingRepository {
  services: ServiceItem[] = [
    {
      id: SERVICE_ID,
      name: 'Headshots - 30 min - $175',
      durationMinutes: 30,
      price: 175,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  ];

  photographers: Photographer[] = [
    {
      id: PHOTOGRAPHER_ID,
      name: 'Photographer One',
      isActive: true
    }
  ];

  bookings: Booking[] = [];
  locks: SlotLock[] = [];

  async getServices(): Promise<ServiceItem[]> {
    return [...this.services];
  }

  async upsertServices(services: ServiceItem[]): Promise<void> {
    this.services = [...services];
  }

  async createServiceItem(service: ServiceItem): Promise<void> {
    this.services.push({ ...service });
  }

  async updateServiceItem(service: ServiceItem): Promise<void> {
    const index = this.services.findIndex((item) => item.id === service.id);
    if (index === -1) {
      throw new Error('SERVICE_NOT_FOUND');
    }

    this.services[index] = { ...service };
  }

  async archiveServiceItem(serviceId: string): Promise<ServiceItem | null> {
    const index = this.services.findIndex((item) => item.id === serviceId);
    if (index === -1) {
      return null;
    }

    const service = this.services[index];
    if (!service) {
      return null;
    }
    const archived: ServiceItem = {
      ...service,
      isActive: false,
      updatedAt: Date.now()
    };
    this.services[index] = archived;
    return archived;
  }

  async getPhotographers(): Promise<Photographer[]> {
    return [...this.photographers];
  }

  async getBookingsForDay(dayKey: string): Promise<Booking[]> {
    return this.bookings.filter((booking) => booking.dayKey === dayKey);
  }

  async getAllBookings(): Promise<Booking[]> {
    return [...this.bookings];
  }

  async getBookingsByPhotographer(photographerId: string): Promise<Booking[]> {
    return this.bookings.filter((booking) => booking.photographerId === photographerId);
  }

  async getActiveLocksForDay(dayKey: string, now: number): Promise<SlotLock[]> {
    return this.locks.filter((lock) => lock.dayKey === dayKey && lock.expiresAt > now);
  }

  async getAllLocks(): Promise<SlotLock[]> {
    return [...this.locks];
  }

  async getUserLock(lockId: string, userId: string, now: number): Promise<SlotLock | null> {
    const lock = this.locks.find((candidate) => candidate.id === lockId && candidate.userId === userId);
    if (!lock || lock.expiresAt <= now) {
      return null;
    }

    return lock;
  }

  async getActiveLockByUser(userId: string, now: number): Promise<SlotLock | null> {
    return this.locks.find((lock) => lock.userId === userId && lock.expiresAt > now) ?? null;
  }

  async createLock(lock: SlotLock, now: number): Promise<SlotLock | null> {
    if (lock.expiresAt <= now || lock.startTime < now) {
      return null;
    }

    const activeUserLock = this.locks.some((candidate) => candidate.userId === lock.userId && candidate.expiresAt > now);
    if (activeUserLock) {
      return null;
    }

    const lockConflict = this.locks.some(
      (candidate) =>
        candidate.expiresAt > now &&
        candidate.photographerId === lock.photographerId &&
        overlaps(lock.startTime, lock.endTime, candidate.startTime, candidate.endTime)
    );
    if (lockConflict) {
      return null;
    }

    const bookingConflict = this.bookings.some(
      (candidate) =>
        candidate.status !== 'canceled' &&
        candidate.photographerId === lock.photographerId &&
        overlaps(lock.startTime, lock.endTime, candidate.startTime, candidate.endTime)
    );
    if (bookingConflict) {
      return null;
    }

    this.locks.push(lock);
    return lock;
  }

  async deleteUserLock(lockId: string, userId: string): Promise<boolean> {
    const before = this.locks.length;
    this.locks = this.locks.filter((lock) => !(lock.id === lockId && lock.userId === userId));
    return this.locks.length < before;
  }

  async deleteLocksForPhotographerRange(
    photographerId: string,
    startTime: number,
    endTime: number
  ): Promise<number> {
    const before = this.locks.length;
    this.locks = this.locks.filter(
      (lock) =>
        !(
          lock.photographerId === photographerId &&
          overlaps(startTime, endTime, lock.startTime, lock.endTime)
        )
    );
    return before - this.locks.length;
  }

  async deleteLocksForPhotographer(photographerId: string): Promise<number> {
    const before = this.locks.length;
    this.locks = this.locks.filter((lock) => lock.photographerId !== photographerId);
    return before - this.locks.length;
  }

  async deleteExpiredLocks(now: number): Promise<number> {
    const before = this.locks.length;
    this.locks = this.locks.filter((lock) => lock.expiresAt > now);
    return before - this.locks.length;
  }

  async confirmLockAndCreateBooking(
    lockId: string,
    userId: string,
    booking: Booking,
    now: number
  ): Promise<Booking | null> {
    const lock = this.locks.find((candidate) => candidate.id === lockId && candidate.userId === userId);
    if (!lock || lock.expiresAt <= now) {
      return null;
    }

    const bookingConflict = this.bookings.some(
      (candidate) =>
        candidate.status !== 'canceled' &&
        candidate.photographerId === booking.photographerId &&
        overlaps(booking.startTime, booking.endTime, candidate.startTime, candidate.endTime)
    );
    if (bookingConflict) {
      return null;
    }

    this.bookings.push(booking);
    this.locks = this.locks.filter((candidate) => candidate.id !== lock.id);
    return booking;
  }

  async createBookingDirect(booking: Booking, now: number): Promise<Booking | null> {
    if (booking.startTime < now || booking.endTime <= booking.startTime) {
      return null;
    }

    const lockConflict = this.locks.some(
      (lock) =>
        lock.expiresAt > now &&
        lock.photographerId === booking.photographerId &&
        overlaps(booking.startTime, booking.endTime, lock.startTime, lock.endTime)
    );
    if (lockConflict) {
      return null;
    }

    const bookingConflict = this.bookings.some(
      (candidate) =>
        candidate.status !== 'canceled' &&
        candidate.photographerId === booking.photographerId &&
        overlaps(booking.startTime, booking.endTime, candidate.startTime, candidate.endTime)
    );
    if (bookingConflict) {
      return null;
    }

    this.bookings.push(booking);
    return booking;
  }

  async getBookingById(bookingId: string): Promise<Booking | null> {
    return this.bookings.find((booking) => booking.id === bookingId) ?? null;
  }

  async getBookingsByUser(userId: string): Promise<Booking[]> {
    return this.bookings.filter((booking) => booking.userId === userId);
  }

  async updateBookingStatus(bookingId: string, status: BookingStatus): Promise<Booking> {
    const booking = this.bookings.find((candidate) => candidate.id === bookingId);
    if (!booking) {
      throw new Error('BOOKING_NOT_FOUND');
    }

    booking.status = status;
    return booking;
  }
}

function createAuthRepositoryMock(options: {
  clientBlocksPhotographer?: boolean;
  photographerBlocksClient?: boolean;
  clientActive?: boolean;
  photographerActive?: boolean;
} = {}): AuthRepository {
  const defaultNotificationPreferences = {
    booking: true,
    messages: true,
    community: true
  };
  const users: AuthenticatedUser[] = [
    {
      id: USER_1,
      username: 'client1',
      role: 'client',
      isActive: options.clientActive ?? true,
      passwordHash: 'hash',
      salt: 'salt',
      notificationPreferences: defaultNotificationPreferences,
      blockedUserIds: options.clientBlocksPhotographer ? [PHOTOGRAPHER_ID] : [],
      createdAt: Date.now(),
      failedAttempts: 0,
      lockUntil: null
    },
    {
      id: USER_2,
      username: 'client2',
      role: 'client',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      notificationPreferences: defaultNotificationPreferences,
      blockedUserIds: [],
      createdAt: Date.now(),
      failedAttempts: 0,
      lockUntil: null
    },
    {
      id: PHOTOGRAPHER_ID,
      username: 'photographer',
      role: 'photographer',
      isActive: options.photographerActive ?? true,
      passwordHash: 'hash',
      salt: 'salt',
      notificationPreferences: defaultNotificationPreferences,
      blockedUserIds: options.photographerBlocksClient ? [USER_1] : [],
      createdAt: Date.now(),
      failedAttempts: 0,
      lockUntil: null
    },
    {
      id: 'admin-1',
      username: 'admin',
      role: 'admin',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      notificationPreferences: defaultNotificationPreferences,
      blockedUserIds: [],
      createdAt: Date.now(),
      failedAttempts: 0,
      lockUntil: null
    }
  ];

  return {
    getUserByUsername: vi.fn(async (username: string) => users.find((user) => user.username === username) ?? null),
    findUserByUsername: vi.fn(async (username: string) => users.find((user) => user.username === username) ?? null),
    findUserById: vi.fn(async (userId: string) => users.find((user) => user.id === userId) ?? null),
    getAllUsers: vi.fn(async () => [...users]),
    listUsers: vi.fn(async () => [...users]),
    createUser: vi.fn(async () => undefined),
    updateUserRole: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    updateUserStatus: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    updateLoginState: vi.fn(async () => undefined),
    createSession: vi.fn(async () => undefined),
    findSessionByToken: vi.fn(async () => null),
    deleteSessionByToken: vi.fn(async () => undefined),
    purgeExpiredSessions: vi.fn(async () => undefined)
  };
}

function buildDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildSlotId(startTime: number, endTime: number): string {
  return `slot-${startTime}-${endTime}`;
}

describe('BookingService', () => {
  let repository: InMemoryBookingRepository;
  let service: ReturnType<typeof createBookingService>;
  let notificationServiceMock: {
    createNotification: ReturnType<typeof vi.fn>;
    getUserNotifications: ReturnType<typeof vi.fn>;
    markAsRead: ReturnType<typeof vi.fn>;
    markAllAsRead: ReturnType<typeof vi.fn>;
    getUnreadCount: ReturnType<typeof vi.fn>;
  };
  let outboxServiceMock: {
    enqueue: ReturnType<typeof vi.fn>;
    processDue: ReturnType<typeof vi.fn>;
  };
  let startTime: number;
  let endTime: number;

  beforeEach(() => {
    vi.useFakeTimers();
    const now = new Date(2026, 2, 29, 8, 0, 0, 0);
    vi.setSystemTime(now);

    const slotStart = new Date(2026, 2, 29, 9, 0, 0, 0);
    const slotEnd = new Date(2026, 2, 29, 9, 30, 0, 0);
    startTime = slotStart.getTime();
    endTime = slotEnd.getTime();

    repository = new InMemoryBookingRepository();
    notificationServiceMock = {
      createNotification: vi.fn(async () => null),
      getUserNotifications: vi.fn(async () => []),
      markAsRead: vi.fn(async () => undefined),
      markAllAsRead: vi.fn(async () => undefined),
      getUnreadCount: vi.fn(async () => 0)
    };
    outboxServiceMock = {
      enqueue: vi.fn(async () => ({
        id: 'outbox-1',
        type: 'booking_status_updated',
        payload: {},
        idempotencyKey: 'idempotency-key',
        messageHash: 'message-hash',
        retryCount: 0,
        nextRetryAt: new Date(Date.now()).toISOString(),
        status: 'pending'
      })),
      processDue: vi.fn(async () => 0)
    };
    service = createBookingService(
      repository,
      createAuthRepositoryMock(),
      {
        getOrCreateThread: vi.fn(async () => ({ id: 'thread-1', bookingId: 'booking-1', participants: [], createdAt: Date.now() })),
        getThreadById: vi.fn(async () => null),
        getUserThreads: vi.fn(async () => []),
        getThreadMessages: vi.fn(async () => []),
        getThreadAccessState: vi.fn(async () => ({
          readOnly: false,
          reason: null,
          message: null
        })),
        sendMessage: vi.fn(async () => ({
          id: 'message-1',
          threadId: 'thread-1',
          senderId: USER_1,
          content: 'hello',
          createdAt: Date.now(),
          readBy: [USER_1]
        })),
        markThreadAsRead: vi.fn(async () => undefined),
        getUnreadThreadCount: vi.fn(async () => 0)
      },
      {
        ...notificationServiceMock
      },
      outboxServiceMock
    );
  });

  it('creates a lock for an available slot', async () => {
    const lock = await service.lockSlot(buildSlotId(startTime, endTime), USER_1, SERVICE_ID);

    expect(lock.userId).toBe(USER_1);
    expect(lock.slotId).toBe(buildSlotId(startTime, endTime));
    expect(repository.locks).toHaveLength(1);
  });

  it('allows admin to create, edit, and archive service items', async () => {
    const created = await service.createServiceItem('admin-1', {
      name: 'Family Session - 90 min - $450',
      durationMinutes: 90,
      price: 450
    });

    expect(created.isActive).toBe(true);
    expect(repository.services.some((item) => item.id === created.id)).toBe(true);

    const updated = await service.updateServiceItem('admin-1', created.id, {
      name: 'Family Session - 120 min - $650',
      durationMinutes: 120,
      price: 650
    });
    expect(updated.durationMinutes).toBe(120);

    const archived = await service.archiveServiceItem('admin-1', created.id);
    expect(archived.isActive).toBe(false);

    const activeServices = await service.getServices();
    expect(activeServices.some((item) => item.id === created.id)).toBe(false);
  });

  it('enforces updated service duration when locking slots', async () => {
    await service.updateServiceItem('admin-1', SERVICE_ID, {
      name: 'Headshots - 90 min - $175',
      durationMinutes: 90,
      price: 175
    });

    await expect(
      service.lockSlot(buildSlotId(startTime, endTime), USER_1, SERVICE_ID)
    ).rejects.toMatchObject({
      code: 'SLOT_UNAVAILABLE'
    });

    const ninetyMinuteEnd = startTime + 90 * 60 * 1000;
    const lock = await service.lockSlot(buildSlotId(startTime, ninetyMinuteEnd), USER_1, SERVICE_ID);
    expect(lock.endTime - lock.startTime).toBe(90 * 60 * 1000);
  });

  it('prevents booking archived services', async () => {
    await service.archiveServiceItem('admin-1', SERVICE_ID);

    await expect(
      service.lockSlot(buildSlotId(startTime, endTime), USER_1, SERVICE_ID)
    ).rejects.toMatchObject({
      code: 'SERVICE_NOT_FOUND'
    });
  });

  it('prevents another user from overriding an active lock', async () => {
    await service.lockSlot(buildSlotId(startTime, endTime), USER_1, SERVICE_ID);

    await expect(service.lockSlot(buildSlotId(startTime, endTime), USER_2, SERVICE_ID)).rejects.toMatchObject({
      code: 'NO_PHOTOGRAPHERS_AVAILABLE'
    });
  });

  it('prevents double booking of the same slot', async () => {
    const lock = await service.lockSlot(buildSlotId(startTime, endTime), USER_1, SERVICE_ID);
    const booking = await service.confirmBooking(lock.id, USER_1, SERVICE_ID);

    expect(booking.userId).toBe(USER_1);
    expect(repository.bookings).toHaveLength(1);

    await expect(service.lockSlot(buildSlotId(startTime, endTime), USER_2, SERVICE_ID)).rejects.toMatchObject({
      code: 'NO_PHOTOGRAPHERS_AVAILABLE'
    });
    expect(repository.bookings).toHaveLength(1);
  });

  it('rejects booking confirmation when lock is missing or expired', async () => {
    await expect(service.confirmBooking('missing-lock', USER_1, SERVICE_ID)).rejects.toMatchObject({
      code: 'LOCK_EXPIRED'
    });
  });

  it('releases expired locks via cleanup and allows new lock creation', async () => {
    await service.lockSlot(buildSlotId(startTime, endTime), USER_1, SERVICE_ID);

    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1_000);
    const removed = await service.cleanupExpiredLocks();

    expect(removed).toBe(1);
    expect(repository.locks).toHaveLength(0);

    const nextLock = await service.lockSlot(buildSlotId(startTime, endTime), USER_2, SERVICE_ID);
    expect(nextLock.userId).toBe(USER_2);
    expect(nextLock.dayKey).toBe(buildDateKey(startTime));
  });

  it('marks booking as missed after booking end time and emits notifications/outbox', async () => {
    const bookingStart = new Date(2026, 2, 29, 9, 0, 0, 0).getTime();
    const bookingEnd = new Date(2026, 2, 29, 9, 30, 0, 0).getTime();
    const booking: Booking = {
      id: 'booking-missed',
      userId: USER_1,
      photographerId: PHOTOGRAPHER_ID,
      serviceId: SERVICE_ID,
      slotId: buildSlotId(bookingStart, bookingEnd),
      startTime: bookingStart,
      endTime: bookingEnd,
      dayKey: buildDateKey(bookingStart),
      status: 'confirmed',
      createdAt: new Date(2026, 2, 29, 8, 0, 0, 0).getTime()
    };
    repository.bookings.push(booking);

    const runAt = new Date(2026, 2, 29, 9, 31, 0, 0).getTime();
    const processed = await service.processOverdueItems(runAt);
    expect(processed).toBe(1);
    expect(repository.bookings[0]?.status).toBe('missed');
    expect(notificationServiceMock.createNotification).toHaveBeenCalledTimes(2);
    expect(notificationServiceMock.createNotification).toHaveBeenCalledWith(
      USER_1,
      'booking.missed',
      'Your session was marked as missed',
      expect.objectContaining({
        bookingId: 'booking-missed',
        photographerId: PHOTOGRAPHER_ID
      }),
      `booking-missed-client-booking-missed-${USER_1}`
    );
    expect(outboxServiceMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'booking_status_updated',
        payload: expect.objectContaining({
          bookingId: 'booking-missed',
          newStatus: 'missed'
        })
      })
    );

    const secondRun = await service.processOverdueItems(runAt + 60_000);
    expect(secondRun).toBe(0);
    expect(outboxServiceMock.enqueue).toHaveBeenCalledTimes(1);
  });

  it('generates 24-hour reminders only for due bookings and remains idempotent by dedup key', async () => {
    const dedupKeys = new Set<string>();
    const notificationServiceForReminders = {
      ...notificationServiceMock,
      createNotification: vi.fn(
      async (_userId, _type, _message, _metadata, dedupKey?: string | null) => {
        if (dedupKey && dedupKeys.has(dedupKey)) {
          return null;
        }
        if (dedupKey) {
          dedupKeys.add(dedupKey);
        }
        return {
          id: `notification-${dedupKeys.size}`,
          userId: USER_1,
          type: 'booking.reminder.24h',
          message: 'Reminder',
          metadata: null,
          read: false,
          createdAt: Date.now(),
          dedupKey: dedupKey ?? null
        };
      }
      )
    };
    service = createBookingService(
      repository,
      createAuthRepositoryMock(),
      {
        getOrCreateThread: vi.fn(async () => ({
          id: 'thread-1',
          bookingId: 'booking-1',
          participants: [],
          createdAt: Date.now()
        })),
        getThreadById: vi.fn(async () => null),
        getUserThreads: vi.fn(async () => []),
        getThreadMessages: vi.fn(async () => []),
        getThreadAccessState: vi.fn(async () => ({
          readOnly: false,
          reason: null,
          message: null
        })),
        sendMessage: vi.fn(async () => ({
          id: 'message-1',
          threadId: 'thread-1',
          senderId: USER_1,
          content: 'hello',
          createdAt: Date.now(),
          readBy: [USER_1]
        })),
        markThreadAsRead: vi.fn(async () => undefined),
        getUnreadThreadCount: vi.fn(async () => 0)
      },
      notificationServiceForReminders,
      outboxServiceMock
    );

    const now = Date.now();
    repository.bookings.push(
      {
        id: 'booking-due',
        userId: USER_1,
        photographerId: PHOTOGRAPHER_ID,
        serviceId: SERVICE_ID,
        slotId: buildSlotId(now + 24 * 60 * 60 * 1000, now + 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
        startTime: now + 24 * 60 * 60 * 1000,
        endTime: now + 24 * 60 * 60 * 1000 + 30 * 60 * 1000,
        dayKey: buildDateKey(now + 24 * 60 * 60 * 1000),
        status: 'confirmed',
        createdAt: now
      },
      {
        id: 'booking-not-due',
        userId: USER_1,
        photographerId: PHOTOGRAPHER_ID,
        serviceId: SERVICE_ID,
        slotId: buildSlotId(now + 26 * 60 * 60 * 1000, now + 26 * 60 * 60 * 1000 + 30 * 60 * 1000),
        startTime: now + 26 * 60 * 60 * 1000,
        endTime: now + 26 * 60 * 60 * 1000 + 30 * 60 * 1000,
        dayKey: buildDateKey(now + 26 * 60 * 60 * 1000),
        status: 'confirmed',
        createdAt: now
      }
    );

    const firstRun = await service.processDueReminders(now);
    expect(firstRun).toBe(1);

    const secondRun = await service.processDueReminders(now + 5 * 60 * 1000);
    expect(secondRun).toBe(0);
  });

  it('marks in-progress booking as auto_completed after end grace period', async () => {
    const bookingStart = new Date(2026, 2, 29, 9, 0, 0, 0).getTime();
    const bookingEnd = new Date(2026, 2, 29, 9, 30, 0, 0).getTime();
    const booking: Booking = {
      id: 'booking-auto-complete',
      userId: USER_1,
      photographerId: PHOTOGRAPHER_ID,
      serviceId: SERVICE_ID,
      slotId: buildSlotId(bookingStart, bookingEnd),
      startTime: bookingStart,
      endTime: bookingEnd,
      dayKey: buildDateKey(bookingStart),
      status: 'started',
      createdAt: new Date(2026, 2, 29, 8, 0, 0, 0).getTime()
    };
    repository.bookings.push(booking);

    const runAt = new Date(2026, 2, 29, 9, 46, 0, 0).getTime();
    const processed = await service.processOverdueItems(runAt);
    expect(processed).toBe(1);
    expect(repository.bookings[0]?.status).toBe('auto_completed');
    expect(notificationServiceMock.createNotification).toHaveBeenCalledTimes(2);
    expect(notificationServiceMock.createNotification).toHaveBeenCalledWith(
      USER_1,
      'booking.auto_completed',
      'Session automatically marked as completed',
      expect.objectContaining({
        bookingId: 'booking-auto-complete',
        photographerId: PHOTOGRAPHER_ID
      }),
      `booking-auto-completed-client-booking-auto-complete-${USER_1}`
    );
    expect(outboxServiceMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'booking_status_updated',
        payload: expect.objectContaining({
          bookingId: 'booking-auto-complete',
          newStatus: 'auto_completed'
        })
      })
    );
  });

  it('blocks booking creation when client and photographer are blocked', async () => {
    service = createBookingService(
      repository,
      createAuthRepositoryMock({ clientBlocksPhotographer: true }),
      {
        getOrCreateThread: vi.fn(async () => ({
          id: 'thread-1',
          bookingId: 'booking-1',
          participants: [],
          createdAt: Date.now()
        })),
        getThreadById: vi.fn(async () => null),
        getUserThreads: vi.fn(async () => []),
        getThreadMessages: vi.fn(async () => []),
        getThreadAccessState: vi.fn(async () => ({
          readOnly: false,
          reason: null,
          message: null
        })),
        sendMessage: vi.fn(async () => ({
          id: 'message-1',
          threadId: 'thread-1',
          senderId: USER_1,
          content: 'hello',
          createdAt: Date.now(),
          readBy: [USER_1]
        })),
        markThreadAsRead: vi.fn(async () => undefined),
        getUnreadThreadCount: vi.fn(async () => 0)
      },
      {
        ...notificationServiceMock
      },
      outboxServiceMock
    );

    await expect(service.lockSlot(buildSlotId(startTime, endTime), USER_1, SERVICE_ID)).rejects.toMatchObject({
      code: 'BLOCKED_INTERACTION'
    });
  });

  it('allows admin to create booking on behalf of a client', async () => {
    const created = await service.createBookingByAdmin('admin-1', {
      clientId: USER_1,
      photographerId: PHOTOGRAPHER_ID,
      serviceId: SERVICE_ID,
      startTime
    });

    expect(created.userId).toBe(USER_1);
    expect(created.photographerId).toBe(PHOTOGRAPHER_ID);
    expect(created.createdByRole).toBe('admin');
    expect(created.createdByUserId).toBe('admin-1');
  });

  it('blocks photographer availability and makes the slot unavailable', async () => {
    const blocked = await service.blockPhotographerAvailability(PHOTOGRAPHER_ID, {
      startTime,
      endTime
    });

    expect(blocked.status).toBe('blocked');
    expect(blocked.userId).toBe('');

    await expect(
      service.lockSlot(buildSlotId(startTime, endTime), USER_1, SERVICE_ID)
    ).rejects.toMatchObject({
      code: 'NO_PHOTOGRAPHERS_AVAILABLE'
    });
  });

  it('marks active bookings as photographer_unavailable when admin deactivates photographer', async () => {
    repository.bookings.push(
      {
        id: 'booking-active',
        userId: USER_1,
        photographerId: PHOTOGRAPHER_ID,
        serviceId: SERVICE_ID,
        slotId: buildSlotId(startTime, endTime),
        startTime,
        endTime,
        dayKey: buildDateKey(startTime),
        status: 'confirmed',
        createdAt: Date.now()
      },
      {
        id: 'booking-completed',
        userId: USER_2,
        photographerId: PHOTOGRAPHER_ID,
        serviceId: SERVICE_ID,
        slotId: buildSlotId(startTime + 60 * 60 * 1000, endTime + 60 * 60 * 1000),
        startTime: startTime + 60 * 60 * 1000,
        endTime: endTime + 60 * 60 * 1000,
        dayKey: buildDateKey(startTime),
        status: 'completed',
        createdAt: Date.now()
      }
    );
    repository.locks.push({
      id: 'lock-photographer',
      slotId: buildSlotId(startTime, endTime),
      photographerId: PHOTOGRAPHER_ID,
      userId: USER_1,
      startTime,
      endTime,
      dayKey: buildDateKey(startTime),
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    const updatedCount = await service.markPhotographerUnavailableByAdmin('admin-1', PHOTOGRAPHER_ID);
    expect(updatedCount).toBe(1);
    expect(repository.bookings.find((booking) => booking.id === 'booking-active')?.status).toBe(
      'photographer_unavailable'
    );
    expect(
      repository.bookings.find((booking) => booking.id === 'booking-completed')?.status
    ).toBe('completed');
    expect(repository.locks).toHaveLength(0);
    expect(notificationServiceMock.createNotification).toHaveBeenCalledWith(
      USER_1,
      'booking.photographer_unavailable',
      'Your photographer is no longer available. Please reschedule.',
      expect.objectContaining({
        bookingId: 'booking-active',
        photographerId: PHOTOGRAPHER_ID
      }),
      `booking-photographer-unavailable-client-booking-active-${USER_1}`
    );
  });

  it('rejects booking actions for deactivated users', async () => {
    service = createBookingService(
      repository,
      createAuthRepositoryMock({ clientActive: false }),
      {
        getOrCreateThread: vi.fn(async () => ({
          id: 'thread-1',
          bookingId: 'booking-1',
          participants: [],
          createdAt: Date.now()
        })),
        getThreadById: vi.fn(async () => null),
        getUserThreads: vi.fn(async () => []),
        getThreadMessages: vi.fn(async () => []),
        getThreadAccessState: vi.fn(async () => ({
          readOnly: false,
          reason: null,
          message: null
        })),
        sendMessage: vi.fn(async () => ({
          id: 'message-1',
          threadId: 'thread-1',
          senderId: USER_1,
          content: 'hello',
          createdAt: Date.now(),
          readBy: [USER_1]
        })),
        markThreadAsRead: vi.fn(async () => undefined),
        getUnreadThreadCount: vi.fn(async () => 0)
      },
      {
        ...notificationServiceMock
      },
      outboxServiceMock
    );

    await expect(service.lockSlot(buildSlotId(startTime, endTime), USER_1, SERVICE_ID)).rejects.toMatchObject({
      code: 'FORBIDDEN'
    });
  });
});
