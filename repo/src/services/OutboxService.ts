import type { OutboxMessage } from '@/app/types/domain';
import type { OutboxRepository } from '@/repositories/OutboxRepository';
import { nowMs } from '@/services/timeSource';

export interface EnqueueOutboxInput {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export interface OutboxService {
  enqueue(input: EnqueueOutboxInput): Promise<OutboxMessage>;
  processDue(nowIso?: string): Promise<number>;
}

interface OutboxProcessResult {
  success: boolean;
}

export type OutboxProcessor = (message: OutboxMessage) => Promise<OutboxProcessResult>;

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1_000;

function createId(): string {
  return `outbox-${crypto.randomUUID()}`;
}

function normalizeIso(value: string | undefined): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return value;
  }

  return new Date(nowMs()).toISOString();
}

function nextBackoffDelayMs(retryCount: number): number {
  const exponent = Math.max(0, retryCount - 1);
  return BASE_BACKOFF_MS * 2 ** exponent;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`)
    .join(',')}}`;
}

async function sha256Base64(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const digestBytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of digestBytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

class LocalOutboxService implements OutboxService {
  private readonly outboxRepository: OutboxRepository;
  private readonly processor: OutboxProcessor;

  constructor(outboxRepository: OutboxRepository, processor: OutboxProcessor) {
    this.outboxRepository = outboxRepository;
    this.processor = processor;
  }

  async enqueue(input: EnqueueOutboxInput): Promise<OutboxMessage> {
    const nowIso = new Date(nowMs()).toISOString();
    const canonicalPayload = stableSerialize({
      type: input.type,
      payload: input.payload
    });
    const messageHash = await sha256Base64(canonicalPayload);
    const existing = await this.outboxRepository.findByHash(messageHash);

    if (existing) {
      return existing;
    }

    const message: OutboxMessage = {
      id: createId(),
      type: input.type,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      messageHash,
      retryCount: 0,
      nextRetryAt: nowIso,
      status: 'pending'
    };

    await this.outboxRepository.enqueue(message);
    return message;
  }

  async processDue(nowIso?: string): Promise<number> {
    const effectiveNowIso = normalizeIso(nowIso);
    const now = Date.parse(effectiveNowIso);
    const dueMessages = await this.outboxRepository.listDueMessages(effectiveNowIso);
    let handledCount = 0;

    for (const message of dueMessages) {
      const processingMessage: OutboxMessage = {
        ...message,
        status: 'processing'
      };
      await this.outboxRepository.updateMessage(processingMessage);

      try {
        const result = await this.processor(processingMessage);
        if (!result.success) {
          throw new Error('Outbox processor reported failure.');
        }

        await this.outboxRepository.updateMessage({
          ...processingMessage,
          status: 'completed'
        });
        handledCount += 1;
      } catch {
        const nextRetryCount = message.retryCount + 1;
        const exhausted = nextRetryCount >= MAX_RETRIES;
        const nextRetryAt = exhausted
          ? effectiveNowIso
          : new Date(now + nextBackoffDelayMs(nextRetryCount)).toISOString();

        const failedMessage: OutboxMessage = {
          ...message,
          retryCount: nextRetryCount,
          nextRetryAt,
          status: exhausted ? 'failed' : 'pending'
        };

        await this.outboxRepository.updateMessage(failedMessage);
      }
    }

    return handledCount;
  }
}

async function defaultProcessor(message: OutboxMessage): Promise<OutboxProcessResult> {
  const shouldForceFailure = message.payload.simulateFailure === true;
  return {
    success: !shouldForceFailure
  };
}

export function createOutboxService(
  outboxRepository: OutboxRepository,
  processor: OutboxProcessor = defaultProcessor
): OutboxService {
  return new LocalOutboxService(outboxRepository, processor);
}
