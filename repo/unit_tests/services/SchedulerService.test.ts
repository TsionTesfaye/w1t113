import type { BookingService } from '@/services/BookingService';
import type { OutboxService } from '@/services/OutboxService';
import type { SchedulerRepository } from '@/repositories/SchedulerRepository';
import { createSchedulerService } from '@/services/SchedulerService';
import { describe, expect, it, vi } from 'vitest';

describe('SchedulerService', () => {
  it('runs scheduled tasks without crashing and returns tick summary', async () => {
    const bookingService = {
      cleanupExpiredLocks: vi.fn().mockResolvedValue(2),
      processDueReminders: vi.fn().mockResolvedValue(1),
      processOverdueItems: vi.fn().mockResolvedValue(3)
    } as unknown as BookingService;

    const outboxService = {
      processDue: vi.fn().mockResolvedValue(4)
    } as unknown as OutboxService;

    const schedulerRepository: SchedulerRepository = {
      getState: vi.fn().mockResolvedValue({
        id: 'global',
        lastRunAt: null,
        lastStartupReconciliationAt: null
      }),
      saveState: vi.fn().mockResolvedValue(undefined)
    };

    const scheduler = createSchedulerService(bookingService, outboxService, schedulerRepository);
    const nowIso = '2026-03-29T09:00:00.000Z';

    const result = await scheduler.runTick(nowIso);

    expect(result).toEqual({
      expiredSlotLocks: 2,
      remindersGenerated: 1,
      overdueItemsProcessed: 3,
      outboxMessagesProcessed: 4
    });
    expect(bookingService.cleanupExpiredLocks).toHaveBeenCalledWith(Date.parse(nowIso));
    expect(bookingService.processDueReminders).toHaveBeenCalledWith(Date.parse(nowIso));
    expect(bookingService.processOverdueItems).toHaveBeenCalledWith(Date.parse(nowIso));
    expect(outboxService.processDue).toHaveBeenCalledWith(nowIso);
    expect(schedulerRepository.saveState).toHaveBeenCalledTimes(1);
  });
});

