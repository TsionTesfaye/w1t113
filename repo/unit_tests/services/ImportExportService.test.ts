import type { AuthenticatedUser } from '@/app/types/domain';
import { DB_VERSION, STORE_NAMES, type StoreName } from '@/db/schema';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { ImportExportRepository } from '@/repositories/ImportExportRepository';
import { createImportExportService } from '@/services/ImportExportService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class InMemoryImportExportRepository implements ImportExportRepository {
  stores: Record<StoreName, unknown[]> = {} as Record<StoreName, unknown[]>;
  replaceCalls = 0;

  constructor(seed?: Partial<Record<StoreName, unknown[]>>) {
    for (const storeName of STORE_NAMES) {
      this.stores[storeName] = [...(seed?.[storeName] ?? [])];
    }
  }

  async exportStores(): Promise<Record<StoreName, unknown[]>> {
    const snapshot = {} as Record<StoreName, unknown[]>;
    for (const storeName of STORE_NAMES) {
      snapshot[storeName] = [...this.stores[storeName]];
    }

    return snapshot;
  }

  async replaceStores(stores: Record<StoreName, unknown[]>): Promise<void> {
    this.replaceCalls += 1;
    const next = {} as Record<StoreName, unknown[]>;
    for (const storeName of STORE_NAMES) {
      next[storeName] = [...(stores[storeName] ?? [])];
    }

    this.stores = next;
  }
}

const FIXED_TIME = new Date(2026, 2, 29, 9, 0, 0, 0).getTime();
const ADMIN_USER: AuthenticatedUser = {
  id: 'admin-1',
  username: 'admin',
  role: 'admin',
  isActive: true,
  notificationPreferences: {
    booking: true,
    messages: true,
    community: true
  },
  blockedUserIds: [],
  createdAt: FIXED_TIME,
  failedAttempts: 0,
  lockUntil: null,
  passwordHash: 'hash',
  salt: 'salt'
};

function createAuthRepositoryMock(): AuthRepository {
  return {
    getUserByUsername: async () => null,
    findUserByUsername: async () => null,
    findUserById: async (userId: string) => (userId === ADMIN_USER.id ? { ...ADMIN_USER } : null),
    getAllUsers: async () => [{ ...ADMIN_USER }],
    listUsers: async () => [{ ...ADMIN_USER }],
    createUser: async () => {},
    updateUser: async () => ({ ...ADMIN_USER }),
    updateNotificationPreferences: async () => ({ ...ADMIN_USER }),
    setBlockedUsers: async () => ({ ...ADMIN_USER }),
    updateUserRole: async () => ({ ...ADMIN_USER }),
    updateUserStatus: async () => ({ ...ADMIN_USER }),
    updateLoginState: async () => {},
    createSession: async () => {},
    findSessionByToken: async () => null,
    deleteSessionByToken: async () => {},
    purgeExpiredSessions: async () => {}
  };
}

function createEmptyStores(): Record<StoreName, unknown[]> {
  const stores = {} as Record<StoreName, unknown[]>;
  for (const storeName of STORE_NAMES) {
    stores[storeName] = [];
  }
  return stores;
}

function createUserRecord(
  id: string,
  username: string,
  role: 'admin' | 'photographer' | 'client' | 'moderator' = 'client'
): Record<string, unknown> {
  return {
    id,
    username,
    role,
    isActive: true,
    passwordHash: `hash-${id}`,
    salt: `salt-${id}`,
    createdAt: FIXED_TIME,
    failedAttempts: 0,
    lockUntil: null,
    notificationPreferences: {
      booking: true,
      messages: true,
      community: true
    },
    blockedUserIds: []
  };
}

describe('ImportExportService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_TIME));
  });

  it('accepts valid imports and preserves data integrity', async () => {
    const stores = createEmptyStores();
    stores.users = [
      createUserRecord('client-1', 'client1', 'client'),
      createUserRecord('photographer-1', 'photo1', 'photographer')
    ];
    stores.serviceItems = [
      {
        id: 'service-1',
        name: 'Headshots',
        durationMinutes: 30,
        price: 175,
        isActive: true,
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME
      }
    ];
    stores.bookings = [
      {
        id: 'booking-1',
        userId: 'client-1',
        photographerId: 'photographer-1',
        serviceId: 'service-1',
        slotId: 'slot-1',
        startTime: FIXED_TIME + 60 * 60 * 1000,
        endTime: FIXED_TIME + 90 * 60 * 1000,
        dayKey: '2026-03-30',
        status: 'pending',
        createdAt: FIXED_TIME,
        createdByUserId: 'client-1',
        createdByRole: 'client'
      }
    ];
    stores.posts = [
      {
        id: 'post-1',
        authorId: 'client-1',
        authorRole: 'client',
        type: 'post',
        content: 'Hello community',
        createdAt: FIXED_TIME,
        likeCount: 0,
        favoriteCount: 0
      }
    ];

    const sourceRepository = new InMemoryImportExportRepository(stores);
    const sourceService = createImportExportService(sourceRepository, createAuthRepositoryMock());
    const blob = await sourceService.exportBackup('admin-1');
    const payload = await blob.text();
    expect(payload).toContain('"schemaVersion"');
    expect(payload).toContain('"stores"');

    const targetRepository = new InMemoryImportExportRepository();
    const targetService = createImportExportService(targetRepository, createAuthRepositoryMock());
    await expect(targetService.importBackup('admin-1', payload)).resolves.toBeUndefined();
    expect(targetRepository.stores.users).toEqual(sourceRepository.stores.users);
    expect(targetRepository.stores.bookings).toEqual(sourceRepository.stores.bookings);
    expect(targetRepository.stores.posts).toEqual(sourceRepository.stores.posts);
  });

  it('rejects malformed records and performs no partial writes', async () => {
    const repository = new InMemoryImportExportRepository();
    const service = createImportExportService(repository, createAuthRepositoryMock());
    const stores = createEmptyStores();
    stores.users = [createUserRecord('user-1', 'client')];
    stores.bookings = ['malformed-booking-record'];

    const payload = JSON.stringify({
      schemaVersion: DB_VERSION,
      exportedAt: FIXED_TIME,
      stores
    });

    const validation = await service.validateImport('admin-1', payload);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('bookings[0]'))).toBe(true);

    await expect(service.importBackup('admin-1', payload)).rejects.toMatchObject({
      code: 'INVALID_IMPORT'
    });
    expect(repository.replaceCalls).toBe(0);
  });

  it('rejects imports when foreign keys are missing', async () => {
    const repository = new InMemoryImportExportRepository();
    const service = createImportExportService(repository, createAuthRepositoryMock());
    const stores = createEmptyStores();
    stores.users = [createUserRecord('user-1', 'client')];
    stores.serviceItems = [
      {
        id: 'service-1',
        name: 'Headshots',
        durationMinutes: 30,
        isActive: true,
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME
      }
    ];
    stores.bookings = [
      {
        id: 'booking-1',
        userId: 'missing-user',
        photographerId: 'user-1',
        serviceId: 'service-1',
        slotId: 'slot-1',
        startTime: FIXED_TIME + 60 * 60 * 1000,
        endTime: FIXED_TIME + 90 * 60 * 1000,
        dayKey: '2026-03-30',
        status: 'pending',
        createdAt: FIXED_TIME
      }
    ];
    stores.threads = [
      {
        id: 'thread-1',
        bookingId: 'missing-booking',
        participants: ['user-1'],
        createdAt: FIXED_TIME
      }
    ];
    stores.messages = [
      {
        id: 'message-1',
        threadId: 'missing-thread',
        senderId: 'user-1',
        content: 'hello',
        createdAt: FIXED_TIME,
        readBy: ['user-1']
      }
    ];

    const payload = JSON.stringify({
      schemaVersion: DB_VERSION,
      exportedAt: FIXED_TIME,
      stores
    });

    const validation = await service.validateImport('admin-1', payload);
    expect(validation.valid).toBe(false);
    expect(
      validation.errors.some((error) =>
        error.includes('Field "userId" references missing users record "missing-user"')
      )
    ).toBe(true);
    expect(
      validation.errors.some((error) =>
        error.includes('Field "bookingId" references missing bookings record "missing-booking"')
      )
    ).toBe(true);
    expect(
      validation.errors.some((error) =>
        error.includes('Field "threadId" references missing threads record "missing-thread"')
      )
    ).toBe(true);
  });

  it('rejects invalid enum and type fields', async () => {
    const repository = new InMemoryImportExportRepository();
    const service = createImportExportService(repository, createAuthRepositoryMock());
    const stores = createEmptyStores();
    stores.users = [createUserRecord('user-1', 'client')];
    stores.serviceItems = [
      {
        id: 'service-1',
        name: 'Headshots',
        durationMinutes: 'thirty',
        isActive: true,
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME
      }
    ];
    stores.posts = [
      {
        id: 'post-1',
        authorId: 'user-1',
        authorRole: 'client',
        type: 'announcement',
        content: 'test',
        createdAt: FIXED_TIME,
        likeCount: 0
      }
    ];

    const payload = JSON.stringify({
      schemaVersion: DB_VERSION,
      exportedAt: FIXED_TIME,
      stores
    });

    const validation = await service.validateImport('admin-1', payload);
    expect(validation.valid).toBe(false);
    expect(
      validation.errors.some((error) =>
        error.includes('Field "durationMinutes" must be a finite number.')
      )
    ).toBe(true);
    expect(
      validation.errors.some((error) => error.includes('Field "type" contains invalid value.'))
    ).toBe(true);
  });

  it('rejects payloads with schema version mismatch', async () => {
    const repository = new InMemoryImportExportRepository();
    const service = createImportExportService(repository, createAuthRepositoryMock());

    const payload = JSON.stringify({
      schemaVersion: DB_VERSION + 1,
      exportedAt: FIXED_TIME,
      stores: createEmptyStores()
    });

    const validation = await service.validateImport('admin-1', payload);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('Incompatible backup version'))).toBe(
      true
    );

    await expect(service.importBackup('admin-1', payload)).rejects.toMatchObject({
      code: 'INVALID_IMPORT'
    });
    expect(repository.replaceCalls).toBe(0);
  });

  it('rejects malicious payloads containing unknown stores', async () => {
    const repository = new InMemoryImportExportRepository();
    const service = createImportExportService(repository, createAuthRepositoryMock());

    const payload = JSON.stringify({
      schemaVersion: DB_VERSION,
      exportedAt: FIXED_TIME,
      stores: {
        ...createEmptyStores(),
        __protoPollutionStore: [{ id: 'x' }]
      }
    });

    const validation = await service.validateImport('admin-1', payload);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('unknown store'))).toBe(true);
    await expect(service.importBackup('admin-1', payload)).rejects.toMatchObject({
      code: 'INVALID_IMPORT'
    });
    expect(repository.replaceCalls).toBe(0);
  });
});
