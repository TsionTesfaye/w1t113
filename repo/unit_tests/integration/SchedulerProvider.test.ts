import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runTickMock = vi.fn(async () => ({
  expiredSlotLocks: 0,
  remindersGenerated: 0,
  overdueItemsProcessed: 0,
  outboxMessagesProcessed: 0
}));
const runStartupCatchUpMock = vi.fn(async () => ({
  expiredSlotLocks: 0,
  remindersGenerated: 0,
  overdueItemsProcessed: 0,
  outboxMessagesProcessed: 0
}));

vi.mock('@/app/providers/bookingProvider', () => ({
  getBookingService: vi.fn(() => ({}))
}));

vi.mock('@/app/providers/outboxProvider', () => ({
  getOutboxService: vi.fn(() => ({}))
}));

vi.mock('@/repositories/SchedulerRepository', () => ({
  createSchedulerRepository: vi.fn(() => ({
    getState: vi.fn(async () => ({
      id: 'global',
      lastRunAt: null,
      lastStartupReconciliationAt: null
    })),
    saveState: vi.fn(async () => undefined)
  }))
}));

vi.mock('@/services/SchedulerService', () => ({
  createSchedulerService: vi.fn(() => ({
    runTick: runTickMock,
    runStartupCatchUp: runStartupCatchUpMock
  }))
}));

let mockNow = new Date(2026, 2, 29, 9, 0, 0, 0).getTime();

vi.mock('@/services/timeSource', () => ({
  nowMs: () => mockNow
}));

type StorageListener = (event: { key: string; oldValue: string | null; newValue: string | null }) => void;

interface IntervalEntry {
  id: number;
  everyMs: number;
  nextRunAt: number;
  callback: () => void;
}

function createWindowMock() {
  const storage = new Map<string, string>();
  const listeners = new Set<StorageListener>();
  const intervals = new Map<number, IntervalEntry>();
  let nextIntervalId = 1;

  const localStorage = {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      storage.set(key, value);
    },
    removeItem: (key: string): void => {
      storage.delete(key);
    }
  };

  const windowMock = {
    localStorage,
    addEventListener: vi.fn((event: string, listener: StorageListener) => {
      if (event === 'storage') {
        listeners.add(listener);
      }
    }),
    removeEventListener: vi.fn((event: string, listener: StorageListener) => {
      if (event === 'storage') {
        listeners.delete(listener);
      }
    }),
    setInterval: (callback: unknown, timeout: unknown): number => {
      if (typeof callback !== 'function') {
        throw new Error('setInterval callback must be a function');
      }

      const everyMs = typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : 0;
      const id = nextIntervalId;
      nextIntervalId += 1;

      intervals.set(id, {
        id,
        everyMs,
        nextRunAt: mockNow + everyMs,
        callback: callback as () => void
      });

      return id;
    },
    clearInterval: (timer: unknown): void => {
      if (typeof timer !== 'number') {
        return;
      }
      intervals.delete(timer);
    }
  };

  function advanceTime(ms: number): void {
    const target = mockNow + ms;

    while (true) {
      const nextDue = Array.from(intervals.values())
        .filter((entry) => entry.nextRunAt <= target)
        .sort((left, right) => left.nextRunAt - right.nextRunAt || left.id - right.id)[0];

      if (!nextDue) {
        break;
      }

      mockNow = nextDue.nextRunAt;
      const dueEntries = Array.from(intervals.values())
        .filter((entry) => entry.nextRunAt === mockNow)
        .sort((left, right) => left.id - right.id);

      for (const dueEntry of dueEntries) {
        const current = intervals.get(dueEntry.id);
        if (!current) {
          continue;
        }

        current.callback();

        const afterCallback = intervals.get(dueEntry.id);
        if (afterCallback) {
          afterCallback.nextRunAt = mockNow + afterCallback.everyMs;
          intervals.set(dueEntry.id, afterCallback);
        }
      }
    }

    mockNow = target;
  }

  return {
    windowMock,
    localStorage,
    advanceTime
  };
}

describe('schedulerProvider', () => {
  let harness: ReturnType<typeof createWindowMock>;

  beforeEach(() => {
    mockNow = new Date(2026, 2, 29, 9, 0, 0, 0).getTime();
    runTickMock.mockClear();
    runStartupCatchUpMock.mockClear();
    vi.resetModules();

    harness = createWindowMock();
    (globalThis as { window?: unknown }).window = harness.windowMock as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('runs startup catch-up once and ticks every 60 seconds without duplicate start', async () => {
    const { startScheduler } = await import('@/app/providers/schedulerProvider');

    await startScheduler();
    await startScheduler();
    expect(runStartupCatchUpMock).toHaveBeenCalledTimes(1);

    harness.advanceTime(60_000);
    await Promise.resolve();
    expect(runTickMock).toHaveBeenCalledTimes(1);

    harness.advanceTime(120_000);
    await Promise.resolve();
    expect(runTickMock).toHaveBeenCalledTimes(3);
  });

  it('prevents duplicate execution while another active tab holds leadership', async () => {
    harness.localStorage.setItem(
      'scheduler_leader',
      JSON.stringify({
        tabId: 'other-tab',
        timestamp: mockNow
      })
    );

    const { startScheduler } = await import('@/app/providers/schedulerProvider');
    await startScheduler();
    expect(runStartupCatchUpMock).toHaveBeenCalledTimes(0);

    harness.advanceTime(20_000);
    await Promise.resolve();
    expect(runStartupCatchUpMock).toHaveBeenCalledTimes(0);

    harness.advanceTime(20_000);
    await Promise.resolve();
    expect(runStartupCatchUpMock).toHaveBeenCalledTimes(1);
  });
});
