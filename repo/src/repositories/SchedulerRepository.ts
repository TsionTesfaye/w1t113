import { indexedDbClient } from '@/db/indexedDbClient';

export interface SchedulerState {
  id: 'global';
  lastRunAt: string | null;
  lastStartupReconciliationAt: string | null;
}

export interface SchedulerRepository {
  getState(): Promise<SchedulerState | null>;
  saveState(state: SchedulerState): Promise<void>;
}

function normalizeState(state: SchedulerState | Record<string, unknown> | undefined): SchedulerState | null {
  if (!state || typeof state !== 'object') {
    return null;
  }

  const id = state.id === 'global' ? 'global' : null;
  if (!id) {
    return null;
  }

  return {
    id,
    lastRunAt: typeof state.lastRunAt === 'string' ? state.lastRunAt : null,
    lastStartupReconciliationAt:
      typeof state.lastStartupReconciliationAt === 'string'
        ? state.lastStartupReconciliationAt
        : null
  };
}

class IndexedDbSchedulerRepository implements SchedulerRepository {
  async getState(): Promise<SchedulerState | null> {
    return indexedDbClient.withTransaction(['schedulerState'], 'readonly', async (transaction) => {
      const record = await transaction.get<SchedulerState | Record<string, unknown>>(
        'schedulerState',
        'global'
      );
      return normalizeState(record);
    });
  }

  async saveState(state: SchedulerState): Promise<void> {
    await indexedDbClient.withTransaction(['schedulerState'], 'readwrite', async (transaction) => {
      await transaction.put('schedulerState', state);
    });
  }
}

export function createSchedulerRepository(): SchedulerRepository {
  return new IndexedDbSchedulerRepository();
}
