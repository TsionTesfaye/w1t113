import type { Booking, Message, Thread, UserRole } from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { BookingRepository } from '@/repositories/BookingRepository';
import type { MessageRepository } from '@/repositories/MessagingRepository';
import type { NotificationService } from '@/services/NotificationService';
import { emitMessageChanged } from '@/services/messageEvents';
import { nowMs } from '@/services/timeSource';

const MAX_MESSAGE_LENGTH = 1000;

export type MessageServiceErrorCode =
  | 'BOOKING_NOT_FOUND'
  | 'BOOKING_NOT_ACTIVE'
  | 'THREAD_NOT_FOUND'
  | 'FORBIDDEN'
  | 'BLOCKED'
  | 'INVALID_MESSAGE';

export class MessageServiceError extends Error {
  readonly code: MessageServiceErrorCode;

  constructor(code: MessageServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ThreadSummary {
  thread: Thread;
  booking: Booking;
  lastMessage: Message | null;
  unreadCount: number;
}

export interface ThreadAccessState {
  readOnly: boolean;
  reason: 'booking_inactive' | 'blocked' | null;
  message: string | null;
}

export interface MessageService {
  getOrCreateThread(bookingId: string): Promise<Thread>;
  getUserThreads(userId: string): Promise<ThreadSummary[]>;
  getThreadMessages(threadId: string, userId: string): Promise<Message[]>;
  sendMessage(threadId: string, senderId: string, content: string): Promise<Message>;
  markThreadAsRead(threadId: string, userId: string): Promise<void>;
  getUnreadThreadCount(userId: string): Promise<number>;
  getThreadById(threadId: string, userId: string): Promise<Thread>;
  getThreadAccessState(threadId: string, userId: string): Promise<ThreadAccessState>;
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalizeMessageContent(value: string): string {
  return value.trim();
}

function toKnownRole(role: string | undefined): UserRole {
  if (role === 'admin' || role === 'photographer' || role === 'moderator' || role === 'client') {
    return role;
  }

  return 'client';
}

function displayNameForRole(role: UserRole, username: string | undefined): string {
  if (role === 'admin') {
    return 'Studio';
  }

  if (role === 'photographer') {
    return 'Photographer';
  }

  if (role === 'moderator') {
    return 'Moderator';
  }

  return username?.trim() || 'Client';
}

function sortThreadSummaries(summaries: ThreadSummary[]): ThreadSummary[] {
  return [...summaries].sort((left, right) => {
    const leftTimestamp = left.lastMessage?.createdAt ?? left.thread.createdAt;
    const rightTimestamp = right.lastMessage?.createdAt ?? right.thread.createdAt;
    return rightTimestamp - leftTimestamp;
  });
}

export function isBookingMessagingActive(status: Booking['status']): boolean {
  return status === 'pending' || status === 'confirmed' || status === 'arrived' || status === 'started';
}

class LocalMessageService implements MessageService {
  private readonly messageRepository: MessageRepository;
  private readonly bookingRepository: BookingRepository;
  private readonly authRepository: AuthRepository;
  private readonly notificationService: NotificationService;

  constructor(
    messageRepository: MessageRepository,
    bookingRepository: BookingRepository,
    authRepository: AuthRepository,
    notificationService: NotificationService
  ) {
    this.messageRepository = messageRepository;
    this.bookingRepository = bookingRepository;
    this.authRepository = authRepository;
    this.notificationService = notificationService;
  }

  async getOrCreateThread(bookingId: string): Promise<Thread> {
    const existing = await this.messageRepository.getThreadByBookingId(bookingId);
    if (existing) {
      return existing;
    }

    const booking = await this.bookingRepository.getBookingById(bookingId);
    if (!booking) {
      throw new MessageServiceError('BOOKING_NOT_FOUND', 'Booking conversation could not be created.');
    }

    if (booking.status === 'blocked' || !booking.userId) {
      throw new MessageServiceError(
        'BOOKING_NOT_FOUND',
        'Conversation is unavailable for this booking.'
      );
    }

    const participants = await this.resolveParticipants(booking);
    const thread: Thread = {
      id: createId('thread'),
      bookingId: booking.id,
      participants,
      createdAt: nowMs()
    };

    try {
      await this.messageRepository.createThread(thread);
      return thread;
    } catch (error: unknown) {
      const alreadyCreated = await this.messageRepository.getThreadByBookingId(bookingId);
      if (alreadyCreated) {
        return alreadyCreated;
      }

      throw error;
    }
  }

  async getUserThreads(userId: string): Promise<ThreadSummary[]> {
    await this.requireActiveUser(userId);
    const threads = await this.messageRepository.getThreadsByUser(userId);
    if (threads.length === 0) {
      return [];
    }

    const [viewer, users] = await Promise.all([
      this.authRepository.findUserById(userId),
      this.authRepository.getAllUsers()
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const blockedSet = new Set(viewer?.blockedUserIds ?? []);
    const summaries: ThreadSummary[] = [];

    for (const thread of threads) {
      const booking = await this.bookingRepository.getBookingById(thread.bookingId);
      if (!booking) {
        continue;
      }

      const allMessages = await this.messageRepository.getMessagesByThread(thread.id);
      const messages = allMessages.filter((message) => !blockedSet.has(message.senderId));
      const rawLastMessage = messages[messages.length - 1] ?? null;
      const lastMessage = rawLastMessage
        ? this.normalizeMessage(rawLastMessage, userId, viewer?.role, usersById)
        : null;
      const unreadCount = messages.filter((message) => !message.readBy.includes(userId)).length;

      summaries.push({
        thread,
        booking,
        lastMessage,
        unreadCount
      });
    }

    return sortThreadSummaries(summaries);
  }

  async getThreadMessages(threadId: string, userId: string): Promise<Message[]> {
    await this.requireActiveUser(userId);
    const thread = await this.requireThreadParticipant(threadId, userId);
    const [messages, viewer, users] = await Promise.all([
      this.messageRepository.getMessagesByThread(thread.id),
      this.authRepository.findUserById(userId),
      this.authRepository.getAllUsers()
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const blockedSet = new Set(viewer?.blockedUserIds ?? []);
    const visibleMessages = messages.filter((message) => !blockedSet.has(message.senderId));

    let didUpdateReadState = false;
    const readMarkingTasks: Array<Promise<void>> = [];
    const updatedMessages = visibleMessages.map((message) => {
      if (message.readBy.includes(userId)) {
        return message;
      }

      didUpdateReadState = true;
      readMarkingTasks.push(this.messageRepository.markMessageRead(message.id, userId));
      const normalized = this.normalizeMessage(message, userId, viewer?.role, usersById);
      return {
        ...normalized,
        ...message,
        readBy: [...message.readBy, userId]
      };
    });

    if (readMarkingTasks.length > 0) {
      await Promise.all(readMarkingTasks);
    }

    if (didUpdateReadState) {
      emitMessageChanged(userId);
    }

    return updatedMessages.map((message) =>
      this.normalizeMessage(message, userId, viewer?.role, usersById)
    );
  }

  async sendMessage(threadId: string, senderId: string, content: string): Promise<Message> {
    await this.requireActiveUser(senderId);
    const thread = await this.requireThreadParticipant(threadId, senderId);
    const accessState = await this.resolveThreadAccessState(thread, senderId);
    if (accessState.readOnly) {
      if (accessState.reason === 'booking_inactive') {
        throw new MessageServiceError(
          'BOOKING_NOT_ACTIVE',
          accessState.message ?? 'This conversation is closed'
        );
      }

      throw new MessageServiceError(
        'BLOCKED',
        accessState.message ?? 'Messaging is unavailable due to privacy restrictions.'
      );
    }

    const normalizedContent = normalizeMessageContent(content);
    const senderUser = await this.authRepository.findUserById(senderId);

    if (!normalizedContent) {
      throw new MessageServiceError('INVALID_MESSAGE', 'Message cannot be empty.');
    }

    if (normalizedContent.length > MAX_MESSAGE_LENGTH) {
      throw new MessageServiceError(
        'INVALID_MESSAGE',
        `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters.`
      );
    }

    const senderRole = toKnownRole(senderUser?.role);
    const senderDisplayName = displayNameForRole(senderRole, senderUser?.username);
    const senderBlockedSet = new Set(senderUser?.blockedUserIds ?? []);

    const otherParticipants = thread.participants.filter((participantId) => participantId !== senderId);
    for (const participantId of otherParticipants) {
      const participant = await this.authRepository.findUserById(participantId);
      if (!participant) {
        continue;
      }

      if (participant.blockedUserIds.includes(senderId) || senderBlockedSet.has(participantId)) {
        throw new MessageServiceError(
          'BLOCKED',
          'Message could not be sent because one of the participants is blocked.'
        );
      }
    }

    const message: Message = {
      id: createId('message'),
      threadId: thread.id,
      senderId,
      senderRole,
      senderDisplayName,
      content: normalizedContent,
      createdAt: nowMs(),
      readBy: [senderId]
    };

    await this.messageRepository.createMessage(message);

    await Promise.all(
      otherParticipants.map(async (participantId) => {
        await this.notificationService.createNotification(
          participantId,
          'message_received',
          'New message in your booking conversation',
          {
            threadId: thread.id,
            bookingId: thread.bookingId,
            messageId: message.id,
            actorId: senderId
          },
          `message-received-${message.id}-${participantId}`
        );
      })
    );

    emitMessageChanged(senderId);
    for (const participantId of otherParticipants) {
      emitMessageChanged(participantId);
    }

    return message;
  }

  async markThreadAsRead(threadId: string, userId: string): Promise<void> {
    await this.requireActiveUser(userId);
    const thread = await this.requireThreadParticipant(threadId, userId);
    const [messages, viewer] = await Promise.all([
      this.messageRepository.getMessagesByThread(thread.id),
      this.authRepository.findUserById(userId)
    ]);
    const blockedSet = new Set(viewer?.blockedUserIds ?? []);

    let markedCount = 0;
    for (const message of messages) {
      if (blockedSet.has(message.senderId)) {
        continue;
      }

      if (message.readBy.includes(userId)) {
        continue;
      }

      await this.messageRepository.markMessageRead(message.id, userId);
      markedCount += 1;
    }

    if (markedCount > 0) {
      emitMessageChanged(userId);
    }
  }

  async getUnreadThreadCount(userId: string): Promise<number> {
    await this.requireActiveUser(userId);
    const threads = await this.getUserThreads(userId);
    return threads.reduce((count, thread) => count + thread.unreadCount, 0);
  }

  async getThreadById(threadId: string, userId: string): Promise<Thread> {
    await this.requireActiveUser(userId);
    return this.requireThreadParticipant(threadId, userId);
  }

  async getThreadAccessState(threadId: string, userId: string): Promise<ThreadAccessState> {
    await this.requireActiveUser(userId);
    const thread = await this.requireThreadParticipant(threadId, userId);
    return this.resolveThreadAccessState(thread, userId);
  }

  private async requireThreadParticipant(threadId: string, userId: string): Promise<Thread> {
    const thread = await this.messageRepository.getThreadById(threadId);
    if (!thread) {
      throw new MessageServiceError('THREAD_NOT_FOUND', 'Conversation thread was not found.');
    }

    if (!thread.participants.includes(userId)) {
      throw new MessageServiceError(
        'FORBIDDEN',
        'You are not allowed to access this booking conversation.'
      );
    }

    return thread;
  }

  private async requireActiveUser(userId: string): Promise<void> {
    const user = await this.authRepository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new MessageServiceError(
        'FORBIDDEN',
        'Your account is unavailable for messaging.'
      );
    }
  }

  private async resolveThreadAccessState(thread: Thread, userId: string): Promise<ThreadAccessState> {
    const booking = await this.bookingRepository.getBookingById(thread.bookingId);
    if (!booking) {
      throw new MessageServiceError('BOOKING_NOT_FOUND', 'Booking conversation could not be found.');
    }

    if (!isBookingMessagingActive(booking.status)) {
      return {
        readOnly: true,
        reason: 'booking_inactive',
        message: 'This conversation is closed'
      };
    }

    const viewer = await this.authRepository.findUserById(userId);
    const viewerBlockedSet = new Set(viewer?.blockedUserIds ?? []);

    for (const participantId of thread.participants) {
      if (participantId === userId) {
        continue;
      }

      const participant = await this.authRepository.findUserById(participantId);
      if (!participant) {
        continue;
      }

      if (participant.blockedUserIds.includes(userId) || viewerBlockedSet.has(participantId)) {
        return {
          readOnly: true,
          reason: 'blocked',
          message: 'Messaging is disabled because one of the participants is blocked.'
        };
      }
    }

    return {
      readOnly: false,
      reason: null,
      message: null
    };
  }

  private async resolveParticipants(booking: Booking): Promise<string[]> {
    if (booking.createdByRole === 'admin') {
      return [...new Set([booking.userId, booking.photographerId])];
    }

    const users = await this.authRepository.getAllUsers();
    const activeAdmins = users.filter((user) => user.role === 'admin' && user.isActive);

    const participantIds = new Set<string>([booking.userId, booking.photographerId]);
    for (const admin of activeAdmins) {
      participantIds.add(admin.id);
    }

    return [...participantIds];
  }

  private normalizeMessage(
    message: Message,
    viewerUserId: string,
    viewerRole: UserRole | undefined,
    usersById: Map<string, { id: string; username: string; role: string }>
  ): Message {
    const senderUser = usersById.get(message.senderId);
    const fallbackRole =
      message.senderId === viewerUserId ? viewerRole : senderUser?.role ?? viewerRole;
    const senderRole = toKnownRole(message.senderRole ?? fallbackRole);
    const senderDisplayName =
      message.senderDisplayName ??
      displayNameForRole(senderRole, senderUser?.username ?? undefined);

    return {
      ...message,
      senderRole,
      senderDisplayName
    };
  }
}

export function createMessageService(
  messageRepository: MessageRepository,
  bookingRepository: BookingRepository,
  authRepository: AuthRepository,
  notificationService: NotificationService
): MessageService {
  return new LocalMessageService(
    messageRepository,
    bookingRepository,
    authRepository,
    notificationService
  );
}
