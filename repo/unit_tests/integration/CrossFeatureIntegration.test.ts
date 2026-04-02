import type {
  AuthenticatedUser,
  Booking,
  BookingStatus,
  FormResponse,
  FormTemplate,
  Message,
  Notification,
  NotificationPreference,
  SearchEntityType,
  SearchIndexEntry,
  ServiceItem,
  Session,
  SlotLock,
  Thread,
  User
} from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { BookingRepository } from '@/repositories/BookingRepository';
import type { HealthFormRepository } from '@/repositories/HealthFormRepository';
import type { MessageRepository } from '@/repositories/MessagingRepository';
import type { NotificationRepository } from '@/repositories/NotificationRepository';
import type { SearchRepository } from '@/repositories/SearchRepository';
import { createBookingService, type BookingService } from '@/services/BookingService';
import { createAuthService, type AuthService } from '@/services/AuthService';
import type { AuthenticatedSession } from '@/services/AuthService';
import { createHealthFormService } from '@/services/HealthFormService';
import { createMessageService, type MessageService } from '@/services/MessagingService';
import { createNotificationService } from '@/services/NotificationService';
import { createSearchService } from '@/services/SearchService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
});

vi.mock('@/services/notificationEvents', () => ({
  emitNotificationChanged: vi.fn()
}));

vi.mock('@/services/messageEvents', () => ({
  emitMessageChanged: vi.fn()
}));

const ADMIN_ID = 'admin-1';
const CLIENT_A_ID = 'client-a';
const CLIENT_B_ID = 'client-b';
const PHOTOGRAPHER_ID = 'photographer-1';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

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

function atHourTomorrow(hour: number, minute = 0): number {
  const target = new Date(Date.now());
  target.setDate(target.getDate() + 1);
  target.setHours(hour, minute, 0, 0);
  return target.getTime();
}

function toDateKey(timestamp: number): string {
  const value = new Date(timestamp);
  const year = String(value.getFullYear());
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

class InMemoryAuthRepository implements AuthRepository {
  users: AuthenticatedUser[];
  private sessions = new Map<string, Session>();

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

  async updateLoginState(userId: string, failedAttempts: number, lockUntil: number | null): Promise<void> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      return;
    }

    user.failedAttempts = failedAttempts;
    user.lockUntil = lockUntil;
  }

  async createSession(session: Session): Promise<void> {
    this.sessions.set(session.token, { ...session });
  }

  async findSessionByToken(token: string): Promise<Session | null> {
    return this.sessions.get(token) ?? null;
  }

  async deleteSessionByToken(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  async purgeExpiredSessions(now: number): Promise<void> {
    for (const [token, session] of this.sessions.entries()) {
      if (typeof session.expiresAt === 'number' && session.expiresAt <= now) {
        this.sessions.delete(token);
      }
    }
  }
}

class InMemoryBookingRepository implements BookingRepository {
  services: ServiceItem[] = [];
  photographers = [
    {
      id: PHOTOGRAPHER_ID,
      name: 'photographer',
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

    const existing = this.services[index];
    if (!existing) {
      return null;
    }
    const archived: ServiceItem = {
      ...existing,
      isActive: false,
      updatedAt: Date.now()
    };
    this.services[index] = archived;
    return archived;
  }

  async getPhotographers(): Promise<{ id: string; name: string; isActive: boolean }[]> {
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
    return this.locks.find((lock) => lock.id === lockId && lock.userId === userId && lock.expiresAt > now) ?? null;
  }

  async getActiveLockByUser(userId: string, now: number): Promise<SlotLock | null> {
    return this.locks.find((lock) => lock.userId === userId && lock.expiresAt > now) ?? null;
  }

  async createLock(lock: SlotLock): Promise<SlotLock | null> {
    this.locks.push({ ...lock });
    return lock;
  }

  async deleteUserLock(lockId: string, userId: string): Promise<boolean> {
    const before = this.locks.length;
    this.locks = this.locks.filter((lock) => !(lock.id === lockId && lock.userId === userId));
    return before !== this.locks.length;
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
          lock.startTime < endTime &&
          lock.endTime > startTime
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
    const lock = await this.getUserLock(lockId, userId, now);
    if (!lock) {
      return null;
    }
    this.locks = this.locks.filter((candidate) => candidate.id !== lockId);
    this.bookings.push({ ...booking });
    return booking;
  }

  async createBookingDirect(booking: Booking, now: number): Promise<Booking | null> {
    if (booking.startTime <= now) {
      return null;
    }

    const conflict = this.bookings.some(
      (candidate) =>
        candidate.status !== 'canceled' &&
        candidate.photographerId === booking.photographerId &&
        candidate.startTime < booking.endTime &&
        candidate.endTime > booking.startTime
    );
    if (conflict) {
      return null;
    }

    this.bookings.push({ ...booking });
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

class InMemoryMessageRepository implements MessageRepository {
  threads: Thread[] = [];
  messages: Message[] = [];

  async createThread(thread: Thread): Promise<void> {
    this.threads.push({ ...thread });
  }

  async getThreadById(threadId: string): Promise<Thread | null> {
    return this.threads.find((thread) => thread.id === threadId) ?? null;
  }

  async getThreadByBookingId(bookingId: string): Promise<Thread | null> {
    return this.threads.find((thread) => thread.bookingId === bookingId) ?? null;
  }

  async getThreadsByUser(userId: string): Promise<Thread[]> {
    return this.threads.filter((thread) => thread.participants.includes(userId));
  }

  async createMessage(message: Message): Promise<void> {
    this.messages.push({ ...message });
  }

  async getMessagesByThread(threadId: string): Promise<Message[]> {
    return this.messages.filter((message) => message.threadId === threadId);
  }

  async markMessageRead(messageId: string, userId: string): Promise<void> {
    const message = this.messages.find((candidate) => candidate.id === messageId);
    if (!message || message.readBy.includes(userId)) {
      return;
    }
    message.readBy = [...message.readBy, userId];
  }
}

class InMemoryNotificationRepository implements NotificationRepository {
  notifications: Notification[] = [];
  preferences: Record<string, NotificationPreference> = {};

  async create(notification: Notification): Promise<void> {
    this.notifications.push({ ...notification });
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

class InMemorySearchRepository implements SearchRepository {
  entries: SearchIndexEntry[] = [];
  synonyms: Record<string, string[]> | null = null;
  tokenizer = {
    strategy: 'simple' as const,
    minTokenLength: 1,
    stopwords: [] as string[]
  };

  async upsertIndexEntry(entry: SearchIndexEntry): Promise<void> {
    const index = this.entries.findIndex((candidate) => candidate.id === entry.id);
    if (index === -1) {
      this.entries.push({ ...entry });
      return;
    }

    this.entries[index] = { ...entry };
  }

  async removeIndexEntry(type: SearchEntityType, entityId: string): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.id !== `${type}:${entityId}`);
  }

  async listIndexEntries(type?: SearchEntityType): Promise<SearchIndexEntry[]> {
    if (!type) {
      return [...this.entries];
    }

    return this.entries.filter((entry) => entry.type === type);
  }

  async resetIndex(entries: SearchIndexEntry[]): Promise<void> {
    this.entries = [...entries];
  }

  async getSearchConfig() {
    return this.synonyms
      ? {
          synonyms: { ...this.synonyms },
          tokenizer: { ...this.tokenizer, stopwords: [...this.tokenizer.stopwords] },
          updatedAt: Date.now()
        }
      : null;
  }

  async saveSearchConfig(config: {
    synonyms: Record<string, string[]>;
    tokenizer: { strategy: 'whitespace' | 'simple' | 'alphanumeric'; minTokenLength: number; stopwords?: string[] };
    updatedAt: number;
  }): Promise<void> {
    this.synonyms = { ...config.synonyms };
    this.tokenizer = {
      strategy: config.tokenizer.strategy,
      minTokenLength: config.tokenizer.minTokenLength,
      stopwords: [...(config.tokenizer.stopwords ?? [])]
    };
  }

  async getSynonyms(): Promise<Record<string, string[]> | null> {
    return this.synonyms ? { ...this.synonyms } : null;
  }

  async saveSynonyms(synonyms: Record<string, string[]>): Promise<void> {
    this.synonyms = { ...synonyms };
  }
}

class InMemoryHealthFormRepository implements HealthFormRepository {
  templates: FormTemplate[] = [];
  responses: FormResponse[] = [];

  async createTemplate(template: FormTemplate): Promise<void> {
    this.templates.push({ ...template });
  }

  async updateTemplate(template: FormTemplate): Promise<void> {
    const index = this.templates.findIndex((candidate) => candidate.id === template.id);
    if (index === -1) {
      this.templates.push({ ...template });
      return;
    }
    this.templates[index] = { ...template };
  }

  async getTemplates(): Promise<FormTemplate[]> {
    return [...this.templates];
  }

  async getActiveTemplates(): Promise<FormTemplate[]> {
    return this.templates.filter((template) => template.isActive);
  }

  async getTemplateById(templateId: string): Promise<FormTemplate | null> {
    return this.templates.find((template) => template.id === templateId) ?? null;
  }

  async saveResponse(response: FormResponse): Promise<void> {
    const index = this.responses.findIndex((candidate) => candidate.id === response.id);
    if (index === -1) {
      this.responses.push({ ...response });
      return;
    }
    this.responses[index] = { ...response };
  }

  async getResponseByBookingAndUser(bookingId: string, userId: string): Promise<FormResponse | null> {
    return this.responses.find((response) => response.bookingId === bookingId && response.userId === userId) ?? null;
  }

  async getResponsesByUser(userId: string): Promise<FormResponse[]> {
    return this.responses.filter((response) => response.userId === userId);
  }

  async getResponsesByBooking(bookingId: string): Promise<FormResponse[]> {
    return this.responses.filter((response) => response.bookingId === bookingId);
  }

  async getAllResponses(): Promise<FormResponse[]> {
    return [...this.responses];
  }

  async deleteResponse(responseId: string): Promise<void> {
    this.responses = this.responses.filter((response) => response.id !== responseId);
  }
}

class AuthServiceSessionStub {
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

  setAdminSession(user: AuthenticatedUser): void {
    this.currentSession = {
      user: toPublicUser(user),
      session: createSession(user.id),
      hasActiveEncryptionKey: false
    };
    this.activeKey = null;
  }

  setNoSession(): void {
    this.currentSession = null;
    this.activeKey = null;
    this.cachedKeysByUserId.clear();
  }

  asAuthService(): AuthService {
    return {
      register: async () => {
        throw new Error('Not implemented');
      },
      isInitialAdminSetupRequired: async () => false,
      bootstrapInitialAdmin: async () => {
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
      logout: async () => {
        this.setNoSession();
      },
      loadSession: async () => this.currentSession,
      getCurrentSession: async () => this.currentSession,
      getActiveEncryptionKey: () => this.activeKey,
      getCachedEncryptionKeyForUser: (userId: string) => this.cachedKeysByUserId.get(userId) ?? null
    };
  }
}

describe('Cross-feature integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 9, 0, 0, 0));
  });

  it('enforces object-level authorization across bookings and notifications', async () => {
    const users = [
      createUser(ADMIN_ID, 'admin', 'admin'),
      createUser(CLIENT_A_ID, 'client-a', 'client'),
      createUser(CLIENT_B_ID, 'client-b', 'client'),
      createUser(PHOTOGRAPHER_ID, 'photographer', 'photographer')
    ];
    const authRepository = new InMemoryAuthRepository(users);
    const bookingRepository = new InMemoryBookingRepository();
    const messageRepository = new InMemoryMessageRepository();
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

    bookingRepository.bookings.push({
      id: 'booking-b-1',
      userId: CLIENT_B_ID,
      photographerId: PHOTOGRAPHER_ID,
      serviceId: 'service-headshots-30',
      slotId: 'slot-b-1',
      startTime: atHourTomorrow(9),
      endTime: atHourTomorrow(9, 30),
      dayKey: '2026-03-30',
      status: 'confirmed',
      createdAt: Date.now()
    });

    const notificationRepository = new InMemoryNotificationRepository();
    const notificationService = createNotificationService(notificationRepository, authRepository, null, null);
    const notification = await notificationService.createNotification(
      CLIENT_B_ID,
      'booking.confirmed',
      'Booking confirmed'
    );
    expect(notification).not.toBeNull();

    await expect(
      notificationService.getUserNotifications(CLIENT_A_ID, CLIENT_B_ID)
    ).rejects.toThrow('Forbidden');
    await expect(
      notificationService.markAsRead(CLIENT_A_ID, notification!.id)
    ).rejects.toThrow('Forbidden');
    await expect(
      bookingService.getBookingsForUser(CLIENT_A_ID, CLIENT_B_ID)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const ownNotifications = await notificationService.getUserNotifications(CLIENT_B_ID, CLIENT_B_ID);
    const ownBookings = await bookingService.getBookingsForUser(CLIENT_B_ID, CLIENT_B_ID);
    expect(ownNotifications).toHaveLength(1);
    expect(ownBookings).toHaveLength(1);
  });

  it('covers booking -> form -> admin view and messaging access by booking state', async () => {
    const users = [
      createUser(ADMIN_ID, 'admin', 'admin'),
      createUser(CLIENT_A_ID, 'client-a', 'client'),
      createUser(PHOTOGRAPHER_ID, 'photographer', 'photographer')
    ];
    const authRepository = new InMemoryAuthRepository(users);
    const bookingRepository = new InMemoryBookingRepository();
    const messageRepository = new InMemoryMessageRepository();
    const formRepository = new InMemoryHealthFormRepository();
    const noopNotificationService = createNoopNotificationService();

    const messageService: MessageService = createMessageService(
      messageRepository,
      bookingRepository,
      authRepository,
      noopNotificationService as unknown as Parameters<typeof createMessageService>[3]
    );
    const bookingService: BookingService = createBookingService(
      bookingRepository,
      authRepository,
      messageService,
      noopNotificationService as unknown as Parameters<typeof createBookingService>[3]
    );

    const authSessionStub = new AuthServiceSessionStub();
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
      throw new Error('Test setup failed: booking service missing.');
    }

    await healthFormService.createTemplate(ADMIN_ID, {
      name: 'Health Declaration',
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

    const activeBooking = await bookingService.createBookingByAdmin(ADMIN_ID, {
      clientId: CLIENT_A_ID,
      photographerId: PHOTOGRAPHER_ID,
      serviceId: service.id,
      startTime: atHourTomorrow(9)
    });

    const clientKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const client = users.find((user) => user.id === CLIENT_A_ID);
    const admin = users.find((user) => user.id === ADMIN_ID);
    if (!client || !admin) {
      throw new Error('Test setup failed: users missing.');
    }

    authSessionStub.setClientSession(client, clientKey);
    await healthFormService.submitForm(CLIENT_A_ID, activeBooking.id, {
      symptoms: 'none'
    });

    authSessionStub.setAdminSession(admin);
    const adminView = await healthFormService.getFormResponseForBooking(ADMIN_ID, activeBooking.id);
    expect(adminView.response?.status).toBe('submitted');
    expect(adminView.answers.symptoms).toBeUndefined();
    expect(adminView.decryptionIssue).toContain('original user session');

    const activeThread = await messageService.getOrCreateThread(activeBooking.id);
    const activeAccess = await messageService.getThreadAccessState(activeThread.id, CLIENT_A_ID);
    expect(activeAccess.readOnly).toBe(false);

    await bookingService.cancelBookingByAdmin(ADMIN_ID, activeBooking.id);
    const canceledAccess = await messageService.getThreadAccessState(activeThread.id, CLIENT_A_ID);
    expect(canceledAccess.readOnly).toBe(true);

    const missedBooking = await bookingService.createBookingByAdmin(ADMIN_ID, {
      clientId: CLIENT_A_ID,
      photographerId: PHOTOGRAPHER_ID,
      serviceId: service.id,
      startTime: atHourTomorrow(10)
    });
    const missedThread = await messageService.getOrCreateThread(missedBooking.id);
    await bookingService.updateBookingStatusByAdmin(ADMIN_ID, missedBooking.id, 'missed');
    const missedAccess = await messageService.getThreadAccessState(missedThread.id, CLIENT_A_ID);
    expect(missedAccess.readOnly).toBe(true);

    const endedBooking = await bookingService.createBookingByAdmin(ADMIN_ID, {
      clientId: CLIENT_A_ID,
      photographerId: PHOTOGRAPHER_ID,
      serviceId: service.id,
      startTime: atHourTomorrow(11)
    });
    const endedThread = await messageService.getOrCreateThread(endedBooking.id);
    await bookingService.updateBookingStatusByAdmin(ADMIN_ID, endedBooking.id, 'confirmed');
    await bookingService.updateBookingStatusByAdmin(ADMIN_ID, endedBooking.id, 'arrived');
    await bookingService.updateBookingStatusByAdmin(ADMIN_ID, endedBooking.id, 'started');
    await bookingService.updateBookingStatusByAdmin(ADMIN_ID, endedBooking.id, 'completed');
    const endedAccess = await messageService.getThreadAccessState(endedThread.id, CLIENT_A_ID);
    expect(endedAccess.readOnly).toBe(true);
  });

  it('covers client booking pending flow, photographer confirmation, forms duplicate guard, and role-switch protection', async () => {
    const users = [
      createUser(ADMIN_ID, 'admin', 'admin'),
      createUser(CLIENT_A_ID, 'client-a', 'client'),
      createUser(PHOTOGRAPHER_ID, 'photographer', 'photographer')
    ];
    const authRepository = new InMemoryAuthRepository(users);
    const bookingRepository = new InMemoryBookingRepository();
    const messageRepository = new InMemoryMessageRepository();
    const formRepository = new InMemoryHealthFormRepository();
    const noopNotificationService = createNoopNotificationService();

    const messageService: MessageService = createMessageService(
      messageRepository,
      bookingRepository,
      authRepository,
      noopNotificationService as unknown as Parameters<typeof createMessageService>[3]
    );
    const bookingService: BookingService = createBookingService(
      bookingRepository,
      authRepository,
      messageService,
      noopNotificationService as unknown as Parameters<typeof createBookingService>[3]
    );

    const authSessionStub = new AuthServiceSessionStub();
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
    await healthFormService.createTemplate(ADMIN_ID, {
      name: 'Health Declaration',
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

    const [service] = await bookingService.getServices();
    if (!service) {
      throw new Error('Test setup failed: missing service');
    }

    const slotDate = toDateKey(atHourTomorrow(9));
    const slots = await bookingService.getSlotsForDate(service.id, slotDate, CLIENT_A_ID);
    const selectedSlot = slots.find((slot) => slot.state === 'available');
    if (!selectedSlot) {
      throw new Error('Test setup failed: no available slot');
    }

    const lock = await bookingService.lockSlot(selectedSlot.id, CLIENT_A_ID, service.id);
    const booking = await bookingService.confirmBooking(lock.id, CLIENT_A_ID, service.id);
    expect(booking.status).toBe('pending');

    const confirmed = await bookingService.updateBookingStatus(
      PHOTOGRAPHER_ID,
      booking.id,
      'confirmed'
    );
    expect(confirmed.status).toBe('confirmed');

    const thread = await messageService.getOrCreateThread(booking.id);
    const access = await messageService.getThreadAccessState(thread.id, CLIENT_A_ID);
    expect(access.readOnly).toBe(false);

    const client = users.find((user) => user.id === CLIENT_A_ID);
    const admin = users.find((user) => user.id === ADMIN_ID);
    if (!client || !admin) {
      throw new Error('Test setup failed: missing users');
    }

    const clientKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    authSessionStub.setClientSession(client, clientKey);
    await healthFormService.submitForm(CLIENT_A_ID, booking.id, {
      symptoms: 'none'
    });

    await expect(
      healthFormService.submitForm(CLIENT_A_ID, booking.id, {
        symptoms: 'none'
      })
    ).rejects.toMatchObject({
      code: 'DUPLICATE_SUBMISSION'
    });

    await authSessionStub.asAuthService().logout();
    authSessionStub.setAdminSession(admin);
    const adminView = await healthFormService.getFormResponseForBooking(ADMIN_ID, booking.id);
    expect(adminView.response?.status).toBe('submitted');
    expect(adminView.answers.symptoms).toBeUndefined();
    expect(adminView.decryptionIssue).toContain('original user session');
  });

  it('clean-db first-run reproducibility: bootstrap -> admin setup -> pending booking -> confirm -> forms duplicate block -> role-switch decrypt denial', async () => {
    const localStorageMock = new MemoryStorage();
    (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
      localStorage: localStorageMock
    };

    const authRepository = new InMemoryAuthRepository([]);
    const authService = createAuthService(authRepository);

    await expect(authService.isInitialAdminSetupRequired()).resolves.toBe(true);
    const admin = await authService.bootstrapInitialAdmin('owner_admin', 'StrongPass!123');
    expect(admin.role).toBe('admin');

    await authService.login({
      username: 'owner_admin',
      password: 'StrongPass!123',
      rememberMe: false
    });

    const client = await authService.createUserByAdmin(admin.id, 'client-smoke', 'ClientPass!123', 'client');
    const photographer = await authService.createUserByAdmin(
      admin.id,
      'photographer-smoke',
      'PhotoPass!123',
      'photographer'
    );

    const bookingRepository = new InMemoryBookingRepository();
    bookingRepository.photographers = [
      {
        id: photographer.id,
        name: photographer.username,
        isActive: true
      }
    ];
    const messageRepository = new InMemoryMessageRepository();
    const formRepository = new InMemoryHealthFormRepository();
    const noopNotificationService = createNoopNotificationService();
    const messageService: MessageService = createMessageService(
      messageRepository,
      bookingRepository,
      authRepository,
      noopNotificationService as unknown as Parameters<typeof createMessageService>[3]
    );
    const bookingService: BookingService = createBookingService(
      bookingRepository,
      authRepository,
      messageService,
      noopNotificationService as unknown as Parameters<typeof createBookingService>[3]
    );
    const healthFormService = createHealthFormService(
      formRepository,
      authRepository,
      bookingRepository,
      noopNotificationService as unknown as Parameters<typeof createHealthFormService>[3],
      authService
    );
    const searchService = createSearchService(
      new InMemorySearchRepository(),
      bookingRepository,
      authRepository,
      {
        getPosts: async () => []
      } as unknown as Parameters<typeof createSearchService>[3]
    );

    await bookingService.createServiceItem(admin.id, {
      name: 'Headshots - 30 min - $175',
      durationMinutes: 30,
      price: 175
    });
    await healthFormService.createTemplate(admin.id, {
      name: 'Health Declaration',
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

    await authService.logout();
    await authService.login({
      username: 'client-smoke',
      password: 'ClientPass!123',
      rememberMe: false
    });

    const [service] = await bookingService.getServices();
    if (!service) {
      throw new Error('Test setup failed: missing service item.');
    }

    const dayKey = toDateKey(atHourTomorrow(9));
    const slots = await bookingService.getSlotsForDate(service.id, dayKey, client.id);
    const slot = slots.find((candidate) => candidate.state === 'available');
    if (!slot) {
      throw new Error('Test setup failed: no available slot.');
    }

    const lock = await bookingService.lockSlot(slot.id, client.id, service.id);
    const booking = await bookingService.confirmBooking(lock.id, client.id, service.id);
    expect(booking.status).toBe('pending');

    await authService.logout();
    await authService.login({
      username: 'photographer-smoke',
      password: 'PhotoPass!123',
      rememberMe: false
    });
    const confirmed = await bookingService.updateBookingStatus(photographer.id, booking.id, 'confirmed');
    expect(confirmed.status).toBe('confirmed');

    const thread = await messageService.getOrCreateThread(booking.id);
    const access = await messageService.getThreadAccessState(thread.id, client.id);
    expect(access.readOnly).toBe(false);

    await searchService.indexBooking(confirmed);
    const clientSearchResults = await searchService.search(client.id, 'headshots');
    expect(clientSearchResults.some((result) => result.type === 'booking')).toBe(true);

    await authService.logout();
    await authService.login({
      username: 'client-smoke',
      password: 'ClientPass!123',
      rememberMe: false
    });

    await healthFormService.submitForm(client.id, booking.id, { symptoms: 'none' });
    await expect(
      healthFormService.submitForm(client.id, booking.id, { symptoms: 'none' })
    ).rejects.toMatchObject({
      code: 'DUPLICATE_SUBMISSION'
    });

    await authService.logout();
    await authService.login({
      username: 'owner_admin',
      password: 'StrongPass!123',
      rememberMe: false
    });
    const adminView = await healthFormService.getFormResponseForBooking(admin.id, booking.id);
    expect(adminView.response?.status).toBe('submitted');
    expect(adminView.answers.symptoms).toBeUndefined();
    expect(adminView.decryptionIssue).toContain('original user session');
  });
});
