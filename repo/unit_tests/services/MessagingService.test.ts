import type {
  AuthenticatedUser,
  Booking,
  Message,
  Session,
  Thread
} from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { BookingRepository } from '@/repositories/BookingRepository';
import type { MessageRepository } from '@/repositories/MessagingRepository';
import { createMessageService, MessageServiceError } from '@/services/MessagingService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CLIENT_ID = 'client-1';
const PHOTOGRAPHER_ID = 'photographer-1';
const ADMIN_ID = 'admin-1';
const THREAD_ID = 'thread-1';
const BOOKING_ID = 'booking-1';

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

  async createUser(): Promise<void> {}

  async updateUser(): Promise<AuthenticatedUser> {
    throw new Error('not implemented');
  }

  async updateNotificationPreferences(): Promise<AuthenticatedUser> {
    throw new Error('not implemented');
  }

  async setBlockedUsers(): Promise<AuthenticatedUser> {
    throw new Error('not implemented');
  }

  async updateUserRole(): Promise<AuthenticatedUser> {
    throw new Error('not implemented');
  }

  async updateUserStatus(): Promise<AuthenticatedUser> {
    throw new Error('not implemented');
  }

  async updateLoginState(): Promise<void> {}

  async createSession(_session: Session): Promise<void> {}

  async findSessionByToken(): Promise<Session | null> {
    return null;
  }

  async deleteSessionByToken(): Promise<void> {}

  async purgeExpiredSessions(): Promise<void> {}
}

describe('MessagingService', () => {
  let messageRepository: InMemoryMessageRepository;
  let booking: Booking;
  let bookingRepository: BookingRepository;
  let authRepository: InMemoryAuthRepository;
  let notificationService: {
    createNotification: ReturnType<typeof vi.fn>;
    getUserNotifications: ReturnType<typeof vi.fn>;
    getNotificationPreference: ReturnType<typeof vi.fn>;
    updateNotificationPreference: ReturnType<typeof vi.fn>;
    markAsRead: ReturnType<typeof vi.fn>;
    markAllAsRead: ReturnType<typeof vi.fn>;
    getUnreadCount: ReturnType<typeof vi.fn>;
  };

  function createUsers(): AuthenticatedUser[] {
    const defaultPreferences = {
      booking: true,
      messages: true,
      community: true
    };
    const now = Date.now();

    return [
      {
        id: CLIENT_ID,
        username: 'client',
        role: 'client',
        isActive: true,
        passwordHash: 'hash',
        salt: 'salt',
        notificationPreferences: defaultPreferences,
        blockedUserIds: [],
        createdAt: now,
        failedAttempts: 0,
        lockUntil: null
      },
      {
        id: PHOTOGRAPHER_ID,
        username: 'photographer',
        role: 'photographer',
        isActive: true,
        passwordHash: 'hash',
        salt: 'salt',
        notificationPreferences: defaultPreferences,
        blockedUserIds: [],
        createdAt: now,
        failedAttempts: 0,
        lockUntil: null
      },
      {
        id: ADMIN_ID,
        username: 'admin',
        role: 'admin',
        isActive: true,
        passwordHash: 'hash',
        salt: 'salt',
        notificationPreferences: defaultPreferences,
        blockedUserIds: [],
        createdAt: now,
        failedAttempts: 0,
        lockUntil: null
      }
    ];
  }

  beforeEach(() => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });

    messageRepository = new InMemoryMessageRepository();
    booking = {
      id: BOOKING_ID,
      userId: CLIENT_ID,
      photographerId: PHOTOGRAPHER_ID,
      serviceId: 'service-1',
      slotId: 'slot-1',
      startTime: Date.now() + 60_000,
      endTime: Date.now() + 120_000,
      dayKey: '2026-03-29',
      status: 'confirmed',
      createdAt: Date.now()
    };
    bookingRepository = {
      getBookingById: vi.fn(async (bookingId: string) => (bookingId === BOOKING_ID ? { ...booking } : null))
    } as unknown as BookingRepository;
    authRepository = new InMemoryAuthRepository(createUsers());
    notificationService = {
      createNotification: vi.fn(async () => null),
      getUserNotifications: vi.fn(async () => []),
      getNotificationPreference: vi.fn(async () => ({
        userId: CLIENT_ID,
        inAppEnabled: true,
        emailEnabled: false,
        smsEnabled: false,
        booking: true,
        messages: true,
        community: true
      })),
      updateNotificationPreference: vi.fn(async () => ({
        userId: CLIENT_ID,
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

    messageRepository.threads.push({
      id: THREAD_ID,
      bookingId: BOOKING_ID,
      participants: [CLIENT_ID, PHOTOGRAPHER_ID, ADMIN_ID],
      createdAt: Date.now()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows sending when booking is active', async () => {
    const service = createMessageService(
      messageRepository,
      bookingRepository,
      authRepository,
      notificationService
    );

    const message = await service.sendMessage(THREAD_ID, CLIENT_ID, 'Hello team');
    expect(message.content).toBe('Hello team');
    expect(messageRepository.messages).toHaveLength(1);
  });

  it('rejects send when booking is no longer active', async () => {
    booking.status = 'completed';
    const service = createMessageService(
      messageRepository,
      bookingRepository,
      authRepository,
      notificationService
    );

    await expect(service.sendMessage(THREAD_ID, CLIENT_ID, 'Can I still send?')).rejects.toMatchObject({
      code: 'BOOKING_NOT_ACTIVE'
    });
    expect(messageRepository.messages).toHaveLength(0);
  });

  it('rejects send when sender and receiver are blocked', async () => {
    const photographer = authRepository.users.find((user) => user.id === PHOTOGRAPHER_ID);
    if (!photographer) {
      throw new Error('Test setup failed');
    }
    photographer.blockedUserIds = [CLIENT_ID];

    const service = createMessageService(
      messageRepository,
      bookingRepository,
      authRepository,
      notificationService
    );

    await expect(service.sendMessage(THREAD_ID, CLIENT_ID, 'Blocked message')).rejects.toMatchObject({
      code: 'BLOCKED'
    });
    expect(messageRepository.messages).toHaveLength(0);
  });

  it('returns read-only access state when thread participants are blocked', async () => {
    const photographer = authRepository.users.find((user) => user.id === PHOTOGRAPHER_ID);
    if (!photographer) {
      throw new Error('Test setup failed');
    }
    photographer.blockedUserIds = [CLIENT_ID];

    const service = createMessageService(
      messageRepository,
      bookingRepository,
      authRepository,
      notificationService
    );

    const accessState = await service.getThreadAccessState(THREAD_ID, CLIENT_ID);
    expect(accessState.readOnly).toBe(true);
    expect(accessState.reason).toBe('blocked');
  });

  it('returns read-only access state when booking is not active', async () => {
    booking.status = 'completed';
    const service = createMessageService(
      messageRepository,
      bookingRepository,
      authRepository,
      notificationService
    );

    const accessState = await service.getThreadAccessState(THREAD_ID, CLIENT_ID);
    expect(accessState.readOnly).toBe(true);
    expect(accessState.reason).toBe('booking_inactive');
  });

  it('blocks messaging actions for deactivated users', async () => {
    const client = authRepository.users.find((user) => user.id === CLIENT_ID);
    if (!client) {
      throw new Error('Test setup failed');
    }
    client.isActive = false;

    const service = createMessageService(
      messageRepository,
      bookingRepository,
      authRepository,
      notificationService
    );

    await expect(service.sendMessage(THREAD_ID, CLIENT_ID, 'Hello')).rejects.toMatchObject({
      code: 'FORBIDDEN'
    });
  });
});
