import type {
  AdminConfig,
  AuthenticatedUser,
  Notification,
  NotificationPreference,
  Session
} from '@/app/types/domain';
import type { AdminConfigRepository } from '@/repositories/AdminConfigRepository';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { NotificationRepository } from '@/repositories/NotificationRepository';
import { createNotificationService } from '@/services/NotificationService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
});

vi.mock('@/services/notificationEvents', () => ({
  emitNotificationChanged: vi.fn()
}));

class InMemoryNotificationRepository implements NotificationRepository {
  notifications: Notification[] = [];
  preferences: Record<string, NotificationPreference> = {};

  async create(notification: Notification): Promise<void> {
    this.notifications.push(notification);
  }

  async getById(notificationId: string): Promise<Notification | null> {
    return this.notifications.find((notification) => notification.id === notificationId) ?? null;
  }

  async getByUser(userId: string): Promise<Notification[]> {
    return this.notifications
      .filter((notification) => notification.userId === userId)
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  async getPreference(userId: string): Promise<NotificationPreference | null> {
    return this.preferences[userId] ?? null;
  }

  async savePreference(preference: NotificationPreference): Promise<void> {
    this.preferences[preference.userId] = { ...preference };
  }

  async markAsRead(notificationId: string): Promise<void> {
    const target = this.notifications.find((notification) => notification.id === notificationId);
    if (!target) {
      return;
    }

    target.read = true;
  }

  async markAllAsRead(userId: string): Promise<void> {
    this.notifications
      .filter((notification) => notification.userId === userId)
      .forEach((notification) => {
        notification.read = true;
      });
  }

  async existsByDedupKey(dedupKey: string): Promise<boolean> {
    return this.notifications.some((notification) => notification.dedupKey === dedupKey);
  }
}

class InMemoryAuthRepository implements AuthRepository {
  users: AuthenticatedUser[];

  constructor(users: AuthenticatedUser[]) {
    this.users = users.map((user) => ({ ...user }));
  }

  async getUserByUsername(username: string): Promise<AuthenticatedUser | null> {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async findUserByUsername(username: string): Promise<AuthenticatedUser | null> {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async findUserById(userId: string): Promise<AuthenticatedUser | null> {
    return this.users.find((user) => user.id === userId) ?? null;
  }

  async getAllUsers(): Promise<AuthenticatedUser[]> {
    return [...this.users];
  }

  async listUsers(): Promise<AuthenticatedUser[]> {
    return [...this.users];
  }

  async createUser(user: AuthenticatedUser): Promise<void> {
    this.users.push({ ...user });
  }

  async updateUser(userId: string, updates: { username?: string }): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }
    if (updates.username) {
      user.username = updates.username;
    }
    return { ...user };
  }

  async updateNotificationPreferences(
    userId: string,
    preferences: AuthenticatedUser['notificationPreferences']
  ): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }
    user.notificationPreferences = { ...preferences };
    return { ...user };
  }

  async setBlockedUsers(userId: string, blockedUserIds: string[]): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }
    user.blockedUserIds = [...blockedUserIds];
    return { ...user };
  }

  async updateUserRole(
    userId: string,
    role: AuthenticatedUser['role']
  ): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }
    user.role = role;
    return { ...user };
  }

  async updateUserStatus(userId: string, isActive: boolean): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }
    user.isActive = isActive;
    return { ...user };
  }

  async updateLoginState(_userId: string, _failedAttempts: number, _lockUntil: number | null): Promise<void> {
    return;
  }

  async createSession(_session: Session): Promise<void> {
    return;
  }

  async findSessionByToken(_token: string): Promise<Session | null> {
    return null;
  }

  async deleteSessionByToken(_token: string): Promise<void> {
    return;
  }

  async purgeExpiredSessions(_now: number): Promise<void> {
    return;
  }
}

class InMemoryAdminConfigRepository implements AdminConfigRepository {
  config: AdminConfig | null = null;

  async getConfig(): Promise<AdminConfig | null> {
    return this.config ? { ...this.config } : null;
  }

  async saveConfig(config: AdminConfig): Promise<void> {
    this.config = { ...config };
  }
}

function createUser(id: string, overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id,
    username: id,
    role: 'client',
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
    lockUntil: null,
    ...overrides
  };
}

describe('NotificationService', () => {
  let repository: InMemoryNotificationRepository;
  let service: ReturnType<typeof createNotificationService>;
  let outboxServiceMock: {
    enqueue: ReturnType<typeof vi.fn>;
    processDue: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 9, 0, 0, 0));

    repository = new InMemoryNotificationRepository();
    outboxServiceMock = {
      enqueue: vi.fn(async () => ({
        id: 'outbox-1',
        type: 'notification.created',
        payload: {},
        idempotencyKey: 'notification-created-1',
        messageHash: 'hash',
        retryCount: 0,
        nextRetryAt: new Date().toISOString(),
        status: 'pending'
      })),
      processDue: vi.fn(async () => 0)
    };
    service = createNotificationService(repository, null, null, outboxServiceMock);
  });

  it('creates a notification with expected properties', async () => {
    const created = await service.createNotification('user-1', 'booking.confirmed', 'Booking confirmed');

    expect(created).not.toBeNull();
    expect(created?.userId).toBe('user-1');
    expect(created?.type).toBe('booking.confirmed');
    expect(repository.notifications).toHaveLength(1);
    expect(outboxServiceMock.enqueue).toHaveBeenCalledTimes(1);
    expect(outboxServiceMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'notification.created',
        idempotencyKey: expect.stringMatching(/^notification-created-/)
      })
    );
  });

  it('prevents duplicate notifications with the same dedup key', async () => {
    const first = await service.createNotification(
      'user-1',
      'booking.confirmed',
      'Booking confirmed',
      null,
      'dedup-1'
    );
    const second = await service.createNotification(
      'user-1',
      'booking.confirmed',
      'Booking confirmed',
      null,
      'dedup-1'
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(repository.notifications).toHaveLength(1);
    expect(outboxServiceMock.enqueue).toHaveBeenCalledTimes(1);
  });

  it('enforces max 3 notifications per type per user per day', async () => {
    for (let index = 0; index < 3; index += 1) {
      const created = await service.createNotification('user-1', 'booking.reminder', `Reminder ${index}`);
      expect(created).not.toBeNull();
    }

    const fourth = await service.createNotification('user-1', 'booking.reminder', 'Reminder 4');
    expect(fourth).toBeNull();
    expect(repository.notifications).toHaveLength(3);
  });

  it('marks a single notification as read', async () => {
    const notification = await service.createNotification('user-1', 'booking.confirmed', 'Booking confirmed');
    expect(notification?.read).toBe(false);

    await service.markAsRead('user-1', notification!.id);
    const stored = await repository.getById(notification!.id);
    expect(stored?.read).toBe(true);
  });

  it('marks all notifications for a user as read', async () => {
    await service.createNotification('user-1', 'type-a', 'A');
    await service.createNotification('user-1', 'type-b', 'B');
    await service.createNotification('user-2', 'type-a', 'C');

    await service.markAllAsRead('user-1', 'user-1');

    const user1Notifications = await repository.getByUser('user-1');
    const user2Notifications = await repository.getByUser('user-2');
    expect(user1Notifications.every((notification) => notification.read)).toBe(true);
    expect(user2Notifications.some((notification) => !notification.read)).toBe(true);
  });
});

describe('NotificationService policy enforcement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 9, 0, 0, 0));
  });

  it('suppresses notifications when admin disables category', async () => {
    const repository = new InMemoryNotificationRepository();
    const authRepository = new InMemoryAuthRepository([createUser('user-1')]);
    const adminConfigRepository = new InMemoryAdminConfigRepository();
    adminConfigRepository.config = {
      id: 'admin-config',
      notificationSettings: {
        booking: false,
        messages: true,
        community: true
      },
      updatedAt: Date.now()
    };

    const service = createNotificationService(repository, authRepository, adminConfigRepository, null);
    const created = await service.createNotification('user-1', 'booking.confirmed', 'Booking confirmed');

    expect(created).toBeNull();
    expect(repository.notifications).toHaveLength(0);
  });

  it('suppresses notifications between blocked users', async () => {
    const repository = new InMemoryNotificationRepository();
    const authRepository = new InMemoryAuthRepository([
      createUser('receiver-1', { blockedUserIds: ['sender-1'] }),
      createUser('sender-1')
    ]);
    const service = createNotificationService(repository, authRepository, null, null);

    const created = await service.createNotification(
      'receiver-1',
      'message_received',
      'New message',
      { actorId: 'sender-1' }
    );

    expect(created).toBeNull();
    expect(repository.notifications).toHaveLength(0);
  });

  it('deduplicates repeated triggers with same dedup key', async () => {
    const repository = new InMemoryNotificationRepository();
    const authRepository = new InMemoryAuthRepository([createUser('user-1')]);
    const service = createNotificationService(repository, authRepository, null, null);

    await service.createNotification(
      'user-1',
      'booking.reminder.24h',
      'Reminder',
      { bookingId: 'booking-1' },
      'booking-reminder-booking-1-user-1'
    );
    await service.createNotification(
      'user-1',
      'booking.reminder.24h',
      'Reminder',
      { bookingId: 'booking-1' },
      'booking-reminder-booking-1-user-1'
    );

    expect(repository.notifications).toHaveLength(1);
  });

  it('keeps in-app notifications enabled even if preference attempts to disable them', async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.savePreference({
      userId: 'user-1',
      inAppEnabled: false,
      emailEnabled: false,
      smsEnabled: false,
      booking: true,
      messages: true,
      community: true
    });
    const authRepository = new InMemoryAuthRepository([createUser('user-1')]);
    const service = createNotificationService(repository, authRepository, null, null);

    const created = await service.createNotification('user-1', 'booking.confirmed', 'Booking confirmed');
    expect(created).not.toBeNull();
    expect(repository.notifications).toHaveLength(1);

    const updatedPreference = await service.updateNotificationPreference('user-1', 'user-1', {
      inAppEnabled: false
    });
    expect(updatedPreference.inAppEnabled).toBe(true);
  });
});
