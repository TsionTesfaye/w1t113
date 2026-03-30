import type { BookingService } from '@/services/BookingService';
import type { OutboxService } from '@/services/OutboxService';
import type { SchedulerRepository } from '@/repositories/SchedulerRepository';
import { nowMs } from '@/services/timeSource';
import { logger } from '@/utils/logger';

export interface SchedulerTickResult {
  expiredSlotLocks: number;
  remindersGenerated: number;
  overdueItemsProcessed: number;
  outboxMessagesProcessed: number;
}

export interface SchedulerService {
  runTick(nowIso?: string): Promise<SchedulerTickResult>;
  runStartupCatchUp(nowIso?: string): Promise<SchedulerTickResult>;
}

class BrowserSchedulerService implements SchedulerService {
  private readonly bookingService: BookingService;
  private readonly outboxService: OutboxService;
  private readonly schedulerRepository: SchedulerRepository;

  constructor(
    bookingService: BookingService,
    outboxService: OutboxService,
    schedulerRepository: SchedulerRepository
  ) {
    this.bookingService = bookingService;
    this.outboxService = outboxService;
    this.schedulerRepository = schedulerRepository;
  }

  async runTick(nowIso?: string): Promise<SchedulerTickResult> {
    const effectiveNowIso = nowIso ?? new Date(nowMs()).toISOString();
    const effectiveNowMs = Date.parse(effectiveNowIso);

    const [expiredSlotLocks, remindersGenerated, overdueItemsProcessed, outboxMessagesProcessed] =
      await Promise.all([
        this.bookingService.cleanupExpiredLocks(effectiveNowMs),
        this.bookingService.processDueReminders(effectiveNowMs),
        this.bookingService.processOverdueItems(effectiveNowMs),
        this.outboxService.processDue(effectiveNowIso)
      ]);

    const result: SchedulerTickResult = {
      expiredSlotLocks,
      remindersGenerated,
      overdueItemsProcessed,
      outboxMessagesProcessed
    };

    await this.schedulerRepository.saveState({
      id: 'global',
      lastRunAt: effectiveNowIso,
      lastStartupReconciliationAt: (await this.schedulerRepository.getState())?.lastStartupReconciliationAt ?? null
    });

    logger.info('SchedulerService tick completed', {
      context: 'SchedulerService',
      nowIso: effectiveNowIso,
      result
    });

    return result;
  }

  async runStartupCatchUp(nowIso?: string): Promise<SchedulerTickResult> {
    const effectiveNowIso = nowIso ?? new Date(nowMs()).toISOString();
    const tickResult = await this.runTick(effectiveNowIso);
    await this.schedulerRepository.saveState({
      id: 'global',
      lastRunAt: effectiveNowIso,
      lastStartupReconciliationAt: effectiveNowIso
    });
    logger.info('SchedulerService startup catch-up completed', {
      context: 'SchedulerService',
      nowIso: effectiveNowIso,
      result: tickResult
    });
    return tickResult;
  }
}

export function createSchedulerService(
  bookingService: BookingService,
  outboxService: OutboxService,
  schedulerRepository: SchedulerRepository
): SchedulerService {
  return new BrowserSchedulerService(bookingService, outboxService, schedulerRepository);
}
