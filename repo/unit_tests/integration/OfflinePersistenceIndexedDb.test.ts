import 'fake-indexeddb/auto';

import type { AuthenticatedUser, Session, User } from '@/app/types/domain';
import { DB_NAME } from '@/db/schema';
import { createAuthRepository } from '@/repositories/AuthRepository';
import { createBookingRepository } from '@/repositories/BookingRepository';
import { createHealthFormRepository } from '@/repositories/HealthFormRepository';
import { createMessageRepository } from '@/repositories/MessagingRepository';
import { createBookingService } from '@/services/BookingService';
import type { AuthService, AuthenticatedSession } from '@/services/AuthService';
import { createHealthFormService } from '@/services/HealthFormService';
import { createMessageService } from '@/services/MessagingService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/notificationEvents', () => ({
  emitNotificationChanged: vi.fn()
}));

vi.mock('@/services/messageEvents', () => ({
  emitMessageChanged: vi.fn()
}));

const ADMIN_ID = 'admin-1';
const CLIENT_ID = 'client-1';
const PHOTOGRAPHER_ID = 'photographer-1';

function createUser(id: string, username: string, role: AuthenticatedUser['role']): AuthenticatedUser {
  return {
    id,
    username,
    role,
    isActive: true,
    passwordHash: 'hash',
    salt: 'salt',
    notificationPreferences: {
      booking: true,
      messages: true,
      community: true
    },
    blockedUserIds: [],
    createdAt: Date.now(),
    failedAttempts: 0,
    lockUntil: null
  };
}

function toPublicUser(user: AuthenticatedUser): User {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    notificationPreferences: user.notificationPreferences,
    blockedUserIds: user.blockedUserIds,
    createdAt: user.createdAt,
    failedAttempts: user.failedAttempts,
    lockUntil: user.lockUntil
  };
}

function createSession(userId: string): Session {
  const createdAt = Date.now();
  return {
    id: `session-${userId}`,
    userId,
    token: `token-${userId}`,
    createdAt,
    expiresAt: null,
    rememberMe: true
  };
}

async function resetDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Unable to reset IndexedDB.'));
    request.onblocked = () => resolve();
  });
}

function atHourTomorrow(hour: number, minute = 0): number {
  const target = new Date(Date.now());
  target.setDate(target.getDate() + 1);
  target.setHours(hour, minute, 0, 0);
  return target.getTime();
}

function createNoopNotificationService() {
  return {
    createNotification: vi.fn(async () => null),
    getUserNotifications: vi.fn(async () => []),
    getNotificationPreference: vi.fn(async () => ({
      userId: '',
      inAppEnabled: true,
      emailEnabled: false,
      smsEnabled: false,
      booking: true,
      messages: true,
      community: true
    })),
    updateNotificationPreference: vi.fn(async () => ({
      userId: '',
      inAppEnabled: true,
      emailEnabled: false,
      smsEnabled: false,
      booking: true,
      messages: true,
      community: true
    })),
    markAsRead: vi.fn(async () => undefined),
    markAllAsRead: vi.fn(async () => undefined),
    getUnreadCount: vi.fn(async () => 0)
  };
}

class AuthSessionStub {
  currentSession: AuthenticatedSession | null = null;
  activeKey: CryptoKey | null = null;
  readonly cachedKeysByUserId = new Map<string, CryptoKey>();

  setClientSession(user: AuthenticatedUser, key: CryptoKey): void {
    this.currentSession = {
      user: toPublicUser(user),
      session: createSession(user.id),
      hasActiveEncryptionKey: true
    };
    this.activeKey = key;
    this.cachedKeysByUserId.set(user.id, key);
  }

  asAuthService(): AuthService {
    return {
      register: async () => {
        throw new Error('Not implemented');
      },
      updateUser: async () => {
        throw new Error('Not implemented');
      },
      updateNotificationPreferences: async () => {
        throw new Error('Not implemented');
      },
      blockUser: async () => {
        throw new Error('Not implemented');
      },
      unblockUser: async () => {
        throw new Error('Not implemented');
      },
      getBlockedUsers: async () => [],
      getAllUsers: async () => [],
      getUsersByIds: async () => [],
      findUserByUsername: async () => null,
      changeUserRole: async () => {
        throw new Error('Not implemented');
      },
      setUserActiveStatus: async () => {
        throw new Error('Not implemented');
      },
      createUserByAdmin: async () => {
        throw new Error('Not implemented');
      },
      login: async () => {
        throw new Error('Not implemented');
      },
      logout: async () => {},
      loadSession: async () => this.currentSession,
      getCurrentSession: async () => this.currentSession,
      getActiveEncryptionKey: () => this.activeKey,
      getCachedEncryptionKeyForUser: (userId: string) => this.cachedKeysByUserId.get(userId) ?? null
    };
  }
}

describe('Offline persistence integration (IndexedDB)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('persists booking and form submission across service reload', async () => {
    const users = [
      createUser(ADMIN_ID, 'admin', 'admin'),
      createUser(CLIENT_ID, 'client', 'client'),
      createUser(PHOTOGRAPHER_ID, 'photographer', 'photographer')
    ];
    const [admin, client] = users;
    if (!admin || !client) {
      throw new Error('Test setup failed: users missing.');
    }

    const authRepository = createAuthRepository();
    for (const user of users) {
      await authRepository.createUser(user);
    }

    const bookingRepository = createBookingRepository();
    const messageRepository = createMessageRepository();
    const formRepository = createHealthFormRepository();
    const noopNotificationService = createNoopNotificationService();
    const messageService = createMessageService(
      messageRepository,
      bookingRepository,
      authRepository,
      noopNotificationService as unknown as Parameters<typeof createMessageService>[3]
    );
    const bookingService = createBookingService(
      bookingRepository,
      authRepository,
      messageService,
      noopNotificationService as unknown as Parameters<typeof createBookingService>[3]
    );

    const authSessionStub = new AuthSessionStub();
    const healthFormService = createHealthFormService(
      formRepository,
      authRepository,
      bookingRepository,
      noopNotificationService as unknown as Parameters<typeof createHealthFormService>[3],
      authSessionStub.asAuthService()
    );

    await bookingService.createServiceItem(ADMIN_ID, {
      name: 'Headshots - 30 min - $175',
      durationMinutes: 30,
      price: 175
    });

    const [service] = await bookingService.getServices();
    if (!service) {
      throw new Error('Test setup failed: missing service.');
    }

    const booking = await bookingService.createBookingByAdmin(ADMIN_ID, {
      clientId: CLIENT_ID,
      photographerId: PHOTOGRAPHER_ID,
      serviceId: service.id,
      startTime: atHourTomorrow(9)
    });

    await healthFormService.createTemplate(ADMIN_ID, {
      name: 'Health',
      isActive: true,
      fields: [
        {
          id: 'symptoms',
          type: 'text',
          label: 'Symptoms',
          required: true
        }
      ]
    });

    const clientKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    authSessionStub.setClientSession(client, clientKey);
    await healthFormService.submitForm(CLIENT_ID, booking.id, { symptoms: 'none' });

    const authRepositoryReloaded = createAuthRepository();
    const bookingRepositoryReloaded = createBookingRepository();
    const messageRepositoryReloaded = createMessageRepository();
    const formRepositoryReloaded = createHealthFormRepository();
    const messageServiceReloaded = createMessageService(
      messageRepositoryReloaded,
      bookingRepositoryReloaded,
      authRepositoryReloaded,
      noopNotificationService as unknown as Parameters<typeof createMessageService>[3]
    );
    const bookingServiceReloaded = createBookingService(
      bookingRepositoryReloaded,
      authRepositoryReloaded,
      messageServiceReloaded,
      noopNotificationService as unknown as Parameters<typeof createBookingService>[3]
    );

    const bookingsAfterReload = await bookingServiceReloaded.getBookingsForUser(CLIENT_ID, CLIENT_ID);
    const responseAfterReload = await formRepositoryReloaded.getResponseByBookingAndUser(
      booking.id,
      CLIENT_ID
    );

    expect(bookingsAfterReload.some((entry) => entry.id === booking.id)).toBe(true);
    expect(responseAfterReload?.status).toBe('submitted');
  });
});
