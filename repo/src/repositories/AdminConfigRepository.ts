import type { AdminConfig, AdminNotificationSettings } from '@/app/types/domain';
import { indexedDbClient } from '@/db/indexedDbClient';

const ADMIN_CONFIG_ID = 'admin-config';

function normalizeNotificationSettings(
  value: Partial<AdminNotificationSettings> | undefined
): AdminNotificationSettings {
  return {
    booking: value?.booking !== false,
    messages: value?.messages !== false,
    community: value?.community !== false
  };
}

function normalizeAdminConfig(record: Partial<AdminConfig> | undefined): AdminConfig | null {
  if (!record || typeof record.id !== 'string') {
    return null;
  }

  return {
    id: record.id,
    notificationSettings: normalizeNotificationSettings(record.notificationSettings),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0
  };
}

export interface AdminConfigRepository {
  getConfig(): Promise<AdminConfig | null>;
  saveConfig(config: AdminConfig): Promise<void>;
}

class IndexedDbAdminConfigRepository implements AdminConfigRepository {
  async getConfig(): Promise<AdminConfig | null> {
    return indexedDbClient.withTransaction(['appConfig'], 'readonly', async (transaction) => {
      const record = await transaction.get<Partial<AdminConfig>>('appConfig', ADMIN_CONFIG_ID);
      return normalizeAdminConfig(record);
    });
  }

  async saveConfig(config: AdminConfig): Promise<void> {
    await indexedDbClient.withTransaction(['appConfig'], 'readwrite', async (transaction) => {
      await transaction.put('appConfig', {
        id: ADMIN_CONFIG_ID,
        notificationSettings: normalizeNotificationSettings(config.notificationSettings),
        updatedAt: config.updatedAt
      });
    });
  }
}

export function createAdminConfigRepository(): AdminConfigRepository {
  return new IndexedDbAdminConfigRepository();
}
