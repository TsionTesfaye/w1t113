import type { OutboxMessage } from '@/app/types/domain';
import { indexedDbClient } from '@/db/indexedDbClient';

const MAX_RETRIES = 5;

export interface OutboxRepository {
  enqueue(message: OutboxMessage): Promise<void>;
  listDueMessages(nowIso: string): Promise<OutboxMessage[]>;
  findByHash(messageHash: string): Promise<OutboxMessage | null>;
  updateMessage(message: OutboxMessage): Promise<void>;
  getAllMessages(): Promise<OutboxMessage[]>;
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeStatus(value: OutboxMessage['status'] | string): OutboxMessage['status'] {
  if (value === 'pending' || value === 'processing' || value === 'failed' || value === 'completed') {
    return value;
  }

  return 'pending';
}

function normalizeMessage(
  message: OutboxMessage | Record<string, unknown> | undefined
): OutboxMessage | null {
  if (
    !message ||
    typeof message !== 'object' ||
    typeof message.id !== 'string' ||
    typeof message.type !== 'string' ||
    typeof message.idempotencyKey !== 'string' ||
    typeof message.messageHash !== 'string' ||
    typeof message.nextRetryAt !== 'string'
  ) {
    return null;
  }

  const retryCount =
    typeof message.retryCount === 'number' && Number.isFinite(message.retryCount)
      ? Math.max(0, Math.floor(message.retryCount))
      : 0;

  const payload =
    message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)
      ? (message.payload as Record<string, unknown>)
      : {};

  return {
    id: message.id,
    type: message.type,
    payload,
    idempotencyKey: message.idempotencyKey,
    messageHash: message.messageHash,
    retryCount,
    nextRetryAt: message.nextRetryAt,
    status: normalizeStatus(
      typeof message.status === 'string' ? message.status : 'pending'
    )
  };
}

function sortByDueDate(messages: OutboxMessage[]): OutboxMessage[] {
  return [...messages].sort((left, right) => {
    const leftDue = toTimestamp(left.nextRetryAt);
    const rightDue = toTimestamp(right.nextRetryAt);
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    return left.id.localeCompare(right.id);
  });
}

class IndexedDbOutboxRepository implements OutboxRepository {
  async enqueue(message: OutboxMessage): Promise<void> {
    await indexedDbClient.withTransaction(['outbox'], 'readwrite', async (transaction) => {
      await transaction.put('outbox', message);
    });
  }

  async listDueMessages(nowIso: string): Promise<OutboxMessage[]> {
    const now = toTimestamp(nowIso);

    return indexedDbClient.withTransaction(['outbox'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<OutboxMessage | Record<string, unknown>>('outbox');
      const messages = records
        .map((record) => normalizeMessage(record))
        .filter(Boolean) as OutboxMessage[];

      return sortByDueDate(
        messages.filter((message) => {
          if (message.status !== 'pending') {
            return false;
          }

          if (message.retryCount >= MAX_RETRIES) {
            return false;
          }

          const dueAt = toTimestamp(message.nextRetryAt);
          return dueAt <= now;
        })
      );
    });
  }

  async findByHash(messageHash: string): Promise<OutboxMessage | null> {
    if (!messageHash) {
      return null;
    }

    return indexedDbClient.withTransaction(['outbox'], 'readonly', async (transaction) => {
      const byIndex = await transaction.getByIndex<OutboxMessage | Record<string, unknown>>(
        'outbox',
        'messageHash',
        messageHash
      );
      if (byIndex) {
        return normalizeMessage(byIndex);
      }

      const records = await transaction.getAll<OutboxMessage | Record<string, unknown>>('outbox');
      const fallback = records
        .map((record) => normalizeMessage(record))
        .filter(Boolean)
        .find((message) => message?.messageHash === messageHash);

      return fallback ?? null;
    });
  }

  async updateMessage(message: OutboxMessage): Promise<void> {
    await indexedDbClient.withTransaction(['outbox'], 'readwrite', async (transaction) => {
      await transaction.put('outbox', message);
    });
  }

  async getAllMessages(): Promise<OutboxMessage[]> {
    return indexedDbClient.withTransaction(['outbox'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<OutboxMessage | Record<string, unknown>>('outbox');
      const messages = records
        .map((record) => normalizeMessage(record))
        .filter(Boolean) as OutboxMessage[];
      return sortByDueDate(messages);
    });
  }
}

export function createOutboxRepository(): OutboxRepository {
  return new IndexedDbOutboxRepository();
}
