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

type StorageListener = (event: { key: string; oldValue: string | null; newValue: string | null }) => void;

function createWindowMock() {
  const storage = new Map<string, string>();
  const listeners = new Set<StorageListener>();

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
    setInterval,
    clearInterval
  };

  return {
    windowMock,
    localStorage
  };
}

describe('schedulerProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 9, 0, 0, 0));
    runTickMock.mockClear();
    runStartupCatchUpMock.mockClear();
    vi.resetModules();

    const { windowMock } = createWindowMock();
    (globalThis as { window?: unknown }).window = windowMock as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as { window?: unknown }).window;
  });

  it('runs startup catch-up once and ticks every 60 seconds without duplicate start', async () => {
    const { startScheduler } = await import('@/app/providers/schedulerProvider');

    await startScheduler();
    await startScheduler();
    expect(runStartupCatchUpMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(runTickMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(120_000);
    await Promise.resolve();
    expect(runTickMock).toHaveBeenCalledTimes(3);
  });

  it('prevents duplicate execution while another active tab holds leadership', async () => {
    const { localStorage } = createWindowMock();
    (globalThis as { window?: unknown }).window = {
      ...(globalThis as { window: Window }).window,
      localStorage
    } as unknown as Window & typeof globalThis;

    localStorage.setItem(
      'scheduler_leader',
      JSON.stringify({
        tabId: 'other-tab',
        timestamp: Date.now()
      })
    );

    const { startScheduler } = await import('@/app/providers/schedulerProvider');
    await startScheduler();
    expect(runStartupCatchUpMock).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(20_000);
    await Promise.resolve();
    expect(runStartupCatchUpMock).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(20_000);
    await Promise.resolve();
    expect(runStartupCatchUpMock).toHaveBeenCalledTimes(1);
  });
});
