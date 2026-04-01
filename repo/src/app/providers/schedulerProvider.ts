import { getBookingService } from '@/app/providers/bookingProvider';
import { getOutboxService } from '@/app/providers/outboxProvider';
import { createSchedulerRepository } from '@/repositories/SchedulerRepository';
import { createSchedulerService, type SchedulerService } from '@/services/SchedulerService';
import { nowMs } from '@/services/timeSource';

const schedulerRepository = createSchedulerRepository();
const schedulerService: SchedulerService = createSchedulerService(
  getBookingService(),
  getOutboxService(),
  schedulerRepository
);

const SCHEDULER_LEADER_KEY = 'scheduler_leader';
const LEASE_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const TICK_INTERVAL_MS = 60_000;

const tabId = `tab-${crypto.randomUUID()}`;
let started = false;
let isLeader = false;
let tickIntervalId: number | null = null;
let heartbeatIntervalId: number | null = null;

interface SchedulerLeaderRecord {
  tabId: string;
  timestamp: number;
}

function readLeaderRecord(): SchedulerLeaderRecord | null {
  const rawValue = window.localStorage.getItem(SCHEDULER_LEADER_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<SchedulerLeaderRecord>;
    if (
      typeof parsed.tabId !== 'string' ||
      !parsed.tabId ||
      typeof parsed.timestamp !== 'number' ||
      !Number.isFinite(parsed.timestamp)
    ) {
      return null;
    }

    return {
      tabId: parsed.tabId,
      timestamp: parsed.timestamp
    };
  } catch {
    return null;
  }
}

function writeLeaderRecord(): void {
  const record: SchedulerLeaderRecord = {
    tabId,
    timestamp: nowMs()
  };
  window.localStorage.setItem(SCHEDULER_LEADER_KEY, JSON.stringify(record));
}

function isLeaderRecordExpired(record: SchedulerLeaderRecord, now: number): boolean {
  return now - record.timestamp > LEASE_MS;
}

function stopTickLoop(): void {
  if (tickIntervalId !== null) {
    window.clearInterval(tickIntervalId);
    tickIntervalId = null;
  }
}

function releaseLeadership(): void {
  const current = readLeaderRecord();
  if (current?.tabId === tabId) {
    window.localStorage.removeItem(SCHEDULER_LEADER_KEY);
  }

  isLeader = false;
  stopTickLoop();
}

async function becomeLeader(): Promise<void> {
  if (isLeader) {
    writeLeaderRecord();
    return;
  }

  isLeader = true;
  writeLeaderRecord();
  await schedulerService.runStartupCatchUp();

  if (tickIntervalId === null) {
    tickIntervalId = window.setInterval(() => {
      void schedulerService.runTick();
    }, TICK_INTERVAL_MS);
  }
}

async function evaluateLeadership(): Promise<void> {
  const now = nowMs();
  const current = readLeaderRecord();

  if (isLeader) {
    if (current && current.tabId !== tabId && !isLeaderRecordExpired(current, now)) {
      releaseLeadership();
      return;
    }

    writeLeaderRecord();
    return;
  }

  if (!current || isLeaderRecordExpired(current, now) || current.tabId === tabId) {
    writeLeaderRecord();
    const verified = readLeaderRecord();
    if (verified?.tabId === tabId) {
      await becomeLeader();
    }
  }
}

export async function startScheduler(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  if (started) {
    return;
  }
  started = true;

  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== SCHEDULER_LEADER_KEY) {
      return;
    }

    void evaluateLeadership();
  });
  window.addEventListener('beforeunload', releaseLeadership);

  await evaluateLeadership();

  heartbeatIntervalId = window.setInterval(() => {
    void evaluateLeadership();
  }, HEARTBEAT_INTERVAL_MS);

  if (heartbeatIntervalId === null) {
    // keep no-op branch for type narrowing and consistency
  }
}
