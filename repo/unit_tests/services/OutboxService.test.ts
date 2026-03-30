import type { OutboxMessage } from '@/app/types/domain';
import type { OutboxRepository } from '@/repositories/OutboxRepository';
import { createOutboxService } from '@/services/OutboxService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class InMemoryOutboxRepository implements OutboxRepository {
  messages: OutboxMessage[] = [];

  async enqueue(message: OutboxMessage): Promise<void> {
    this.messages.push({ ...message });
  }

  async listDueMessages(nowIso: string): Promise<OutboxMessage[]> {
    const now = Date.parse(nowIso);
    return this.messages
      .filter(
        (message) =>
          Date.parse(message.nextRetryAt) <= now &&
          message.status === 'pending' &&
          message.retryCount < 5
      )
      .sort((left, right) => Date.parse(left.nextRetryAt) - Date.parse(right.nextRetryAt));
  }

  async findByHash(messageHash: string): Promise<OutboxMessage | null> {
    return this.messages.find((message) => message.messageHash === messageHash) ?? null;
  }

  async updateMessage(message: OutboxMessage): Promise<void> {
    const index = this.messages.findIndex((candidate) => candidate.id === message.id);
    if (index === -1) {
      this.messages.push({ ...message });
      return;
    }

    this.messages[index] = { ...message };
  }

  async getAllMessages(): Promise<OutboxMessage[]> {
    return [...this.messages];
  }
}

describe('OutboxService', () => {
  let repository: InMemoryOutboxRepository;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 9, 0, 0, 0));
    repository = new InMemoryOutboxRepository();
  });

  it('deduplicates messages by hash', async () => {
    const service = createOutboxService(repository);

    const first = await service.enqueue({
      type: 'booking.status',
      payload: { bookingId: 'booking-1', status: 'confirmed' },
      idempotencyKey: 'idem-1'
    });
    const second = await service.enqueue({
      type: 'booking.status',
      payload: { bookingId: 'booking-1', status: 'confirmed' },
      idempotencyKey: 'idem-2'
    });

    expect(first.id).toBe(second.id);
    expect(repository.messages).toHaveLength(1);
  });

  it('retries failed processing with exponential backoff and caps at max retries', async () => {
    const service = createOutboxService(repository, async () => ({ success: false }));
    const created = await service.enqueue({
      type: 'booking.status',
      payload: { bookingId: 'booking-2' },
      idempotencyKey: 'idem-retry'
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = repository.messages.find((message) => message.id === created.id)!;
      const dueAt = Date.parse(current.nextRetryAt);
      vi.setSystemTime(dueAt + 5);
      await service.processDue(new Date(dueAt + 5).toISOString());
    }

    const finalMessage = repository.messages.find((message) => message.id === created.id)!;
    expect(finalMessage.retryCount).toBe(5);
    expect(finalMessage.status).toBe('failed');

    const processedAfterFailure = await service.processDue();
    expect(processedAfterFailure).toBe(0);
    const afterFailureMessage = repository.messages.find((message) => message.id === created.id)!;
    expect(afterFailureMessage.retryCount).toBe(5);
    expect(afterFailureMessage.status).toBe('failed');
  });

  it('marks due messages completed when processor succeeds', async () => {
    const service = createOutboxService(repository, async () => ({ success: true }));
    const created = await service.enqueue({
      type: 'booking.status',
      payload: { bookingId: 'booking-3' },
      idempotencyKey: 'idem-success'
    });

    const processed = await service.processDue();
    expect(processed).toBe(1);

    const stored = repository.messages.find((message) => message.id === created.id)!;
    expect(stored.status).toBe('completed');
  });

  it('resumes pending outbox messages after service restart', async () => {
    const firstInstance = createOutboxService(repository, async () => ({ success: true }));
    const message = await firstInstance.enqueue({
      type: 'booking.status',
      payload: { bookingId: 'booking-restart' },
      idempotencyKey: 'idem-restart'
    });

    const secondInstance = createOutboxService(repository, async () => ({ success: true }));
    vi.setSystemTime(Date.parse(message.nextRetryAt) + 10);
    const processed = await secondInstance.processDue(new Date(Date.now()).toISOString());

    expect(processed).toBe(1);
    const stored = repository.messages.find((candidate) => candidate.id === message.id)!;
    expect(stored.status).toBe('completed');
  });

  it('continues retry progression across restarts', async () => {
    const failingProcessor = vi.fn(async () => ({ success: false }));
    const firstInstance = createOutboxService(repository, failingProcessor);
    const created = await firstInstance.enqueue({
      type: 'booking.status',
      payload: { bookingId: 'booking-retry-restart' },
      idempotencyKey: 'idem-retry-restart'
    });

    vi.setSystemTime(Date.parse(created.nextRetryAt) + 1);
    await firstInstance.processDue(new Date(Date.now()).toISOString());
    expect(repository.messages.find((message) => message.id === created.id)?.retryCount).toBe(1);

    const secondInstance = createOutboxService(repository, failingProcessor);
    const nextRetryAt = Date.parse(
      repository.messages.find((message) => message.id === created.id)!.nextRetryAt
    );
    vi.setSystemTime(nextRetryAt + 1);
    await secondInstance.processDue(new Date(Date.now()).toISOString());

    const stored = repository.messages.find((message) => message.id === created.id)!;
    expect(stored.retryCount).toBe(2);
    expect(stored.status).toBe('pending');
  });

  it('deduplicates by message hash across service instances', async () => {
    const firstInstance = createOutboxService(repository);
    const secondInstance = createOutboxService(repository);

    const first = await firstInstance.enqueue({
      type: 'booking.status',
      payload: { bookingId: 'booking-hash', status: 'confirmed' },
      idempotencyKey: 'idem-hash-1'
    });
    const second = await secondInstance.enqueue({
      type: 'booking.status',
      payload: { bookingId: 'booking-hash', status: 'confirmed' },
      idempotencyKey: 'idem-hash-2'
    });

    expect(first.id).toBe(second.id);
    expect(repository.messages).toHaveLength(1);
  });
});
