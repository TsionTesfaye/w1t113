import type { AdminConfig, AdminNotificationSettings } from '@/app/types/domain';
import type { AdminConfigRepository } from '@/repositories/AdminConfigRepository';
import type { AuthRepository } from '@/repositories/AuthRepository';
import { nowMs } from '@/services/timeSource';

const ADMIN_CONFIG_ID = 'admin-config';

function defaultNotificationSettings(): AdminNotificationSettings {
  return {
    booking: true,
    messages: true,
    community: true
  };
}

function normalizeNotificationSettings(
  value: Partial<AdminNotificationSettings> | undefined
): AdminNotificationSettings {
  return {
    booking: value?.booking !== false,
    messages: value?.messages !== false,
    community: value?.community !== false
  };
}

function defaultConfig(): AdminConfig {
  return {
    id: ADMIN_CONFIG_ID,
    notificationSettings: defaultNotificationSettings(),
    updatedAt: nowMs()
  };
}

export interface AdminConfigService {
  getConfig(actorId: string): Promise<AdminConfig>;
  updateNotificationSettings(
    actorId: string,
    updates: Partial<AdminNotificationSettings>
  ): Promise<AdminConfig>;
}

class LocalAdminConfigService implements AdminConfigService {
  private readonly repository: AdminConfigRepository;
  private readonly authRepository: AuthRepository;

  constructor(repository: AdminConfigRepository, authRepository: AuthRepository) {
    this.repository = repository;
    this.authRepository = authRepository;
  }

  private async requireActiveAdmin(actorId: string): Promise<void> {
    const actor = await this.authRepository.findUserById(actorId);
    if (!actor || !actor.isActive) {
      throw new Error('Unauthorized');
    }

    if (actor.role !== 'admin') {
      throw new Error('Forbidden');
    }
  }

  async getConfig(actorId: string): Promise<AdminConfig> {
    await this.requireActiveAdmin(actorId);
    const stored = await this.repository.getConfig();
    if (!stored) {
      const next = defaultConfig();
      await this.repository.saveConfig(next);
      return next;
    }

    const normalized: AdminConfig = {
      ...stored,
      id: ADMIN_CONFIG_ID,
      notificationSettings: normalizeNotificationSettings(stored.notificationSettings)
    };

    return normalized;
  }

  async updateNotificationSettings(
    actorId: string,
    updates: Partial<AdminNotificationSettings>
  ): Promise<AdminConfig> {
    await this.requireActiveAdmin(actorId);
    const current = await this.getConfig(actorId);
    const updated: AdminConfig = {
      ...current,
      notificationSettings: {
        ...current.notificationSettings,
        ...(typeof updates.booking === 'boolean' ? { booking: updates.booking } : {}),
        ...(typeof updates.messages === 'boolean' ? { messages: updates.messages } : {}),
        ...(typeof updates.community === 'boolean' ? { community: updates.community } : {})
      },
      updatedAt: nowMs()
    };

    await this.repository.saveConfig(updated);
    return updated;
  }
}

export function createAdminConfigService(
  repository: AdminConfigRepository,
  authRepository: AuthRepository
): AdminConfigService {
  return new LocalAdminConfigService(repository, authRepository);
}
