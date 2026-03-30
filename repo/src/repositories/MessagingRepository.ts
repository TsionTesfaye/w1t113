import type { Message, Thread } from '@/app/types/domain';
import { indexedDbClient } from '@/db/indexedDbClient';

export interface MessageRepository {
  createThread(thread: Thread): Promise<void>;
  getThreadById(threadId: string): Promise<Thread | null>;
  getThreadByBookingId(bookingId: string): Promise<Thread | null>;
  getThreadsByUser(userId: string): Promise<Thread[]>;
  createMessage(message: Message): Promise<void>;
  getMessagesByThread(threadId: string): Promise<Message[]>;
  markMessageRead(messageId: string, userId: string): Promise<void>;
}

function sortThreadsByNewest(threads: Thread[]): Thread[] {
  return [...threads].sort((left, right) => right.createdAt - left.createdAt);
}

function sortMessagesByOldest(messages: Message[]): Message[] {
  return [...messages].sort((left, right) => left.createdAt - right.createdAt);
}

class IndexedDbMessageRepository implements MessageRepository {
  async createThread(thread: Thread): Promise<void> {
    await indexedDbClient.withTransaction(['threads'], 'readwrite', async (transaction) => {
      const existing = await transaction.getByIndex<Thread>('threads', 'bookingId', thread.bookingId);
      if (existing) {
        throw new Error('THREAD_ALREADY_EXISTS');
      }

      await transaction.put('threads', thread);
    });
  }

  async getThreadById(threadId: string): Promise<Thread | null> {
    return indexedDbClient.withTransaction(['threads'], 'readonly', async (transaction) => {
      const thread = await transaction.get<Thread>('threads', threadId);
      return thread ?? null;
    });
  }

  async getThreadByBookingId(bookingId: string): Promise<Thread | null> {
    return indexedDbClient.withTransaction(['threads'], 'readonly', async (transaction) => {
      const thread = await transaction.getByIndex<Thread>('threads', 'bookingId', bookingId);
      return thread ?? null;
    });
  }

  async getThreadsByUser(userId: string): Promise<Thread[]> {
    return indexedDbClient.withTransaction(['threads'], 'readonly', async (transaction) => {
      const threads = await transaction.getAll<Thread>('threads');
      return sortThreadsByNewest(
        threads.filter((thread) => Array.isArray(thread.participants) && thread.participants.includes(userId))
      );
    });
  }

  async createMessage(message: Message): Promise<void> {
    await indexedDbClient.withTransaction(['messages'], 'readwrite', async (transaction) => {
      await transaction.put('messages', message);
    });
  }

  async getMessagesByThread(threadId: string): Promise<Message[]> {
    return indexedDbClient.withTransaction(['messages'], 'readonly', async (transaction) => {
      const messages = await transaction.getAllByIndex<Message>('messages', 'threadId', threadId);
      return sortMessagesByOldest(messages);
    });
  }

  async markMessageRead(messageId: string, userId: string): Promise<void> {
    await indexedDbClient.withTransaction(['messages'], 'readwrite', async (transaction) => {
      const message = await transaction.get<Message>('messages', messageId);
      if (!message || message.readBy.includes(userId)) {
        return;
      }

      await transaction.put('messages', {
        ...message,
        readBy: [...message.readBy, userId]
      });
    });
  }
}

export function createMessageRepository(): MessageRepository {
  return new IndexedDbMessageRepository();
}
