import type {
  AuthenticatedUser,
  AdminNotificationSettings,
  Notification,
  NotificationPreference,
  NotificationPreferenceType,
  UserNotificationPreferences
} from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { AdminConfigRepository } from '@/repositories/AdminConfigRepository';
import type { NotificationRepository } from '@/repositories/NotificationRepository';
import type { OutboxService } from '@/services/OutboxService';
import { emitNotificationChanged } from '@/services/notificationEvents';
import { nowMs } from '@/services/timeSource';

const MAX_NOTIFICATIONS_PER_TYPE_PER_DAY = 3;

export interface NotificationService {
  createNotification(
    userId: string,
    type: string,
    message: string,
    metadata?: Record<string, unknown> | null,
    dedupKey?: string | null
  ): Promise<Notification | null>;
  getUserNotifications(actorId: string, userId: string): Promise<Notification[]>;
  getNotificationPreference(actorId: string, userId: string): Promise<NotificationPreference>;
  updateNotificationPreference(
    actorId: string,
    userId: string,
    updates: Partial<
      Pick<
        NotificationPreference,
        'inAppEnabled' | 'emailEnabled' | 'smsEnabled' | 'booking' | 'messages' | 'community'
      >
    >
  ): Promise<NotificationPreference>;
  markAsRead(actorId: string, notificationId: string): Promise<void>;
  markAllAsRead(actorId: string, userId: string): Promise<void>;
  getUnreadCount(actorId: string, userId: string): Promise<number>;
}

function createId(): string {
  return `notification-${crypto.randomUUID()}`;
}

function defaultAdminNotificationSettings(): AdminNotificationSettings {
  return {
    booking: true,
    messages: true,
    community: true
  };
}

function normalizeUserNotificationPreferences(
  value: Partial<UserNotificationPreferences> | undefined
): UserNotificationPreferences {
  return {
    booking: value?.booking !== false,
    messages: value?.messages !== false,
    community: value?.community !== false
  };
}

function normalizeAdminNotificationSettings(
  value: Partial<AdminNotificationSettings> | undefined
): AdminNotificationSettings {
  return {
    booking: value?.booking !== false,
    messages: value?.messages !== false,
    community: value?.community !== false
  };
}

function resolveNotificationType(type: string): NotificationPreferenceType {
  const normalized = type.trim().toLowerCase();
  if (normalized.startsWith('message')) {
    return 'messages';
  }

  if (normalized.startsWith('community')) {
    return 'community';
  }

  return 'booking';
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

class LocalNotificationService implements NotificationService {
  private readonly notificationRepository: NotificationRepository;
  private readonly authRepository: AuthRepository | null;
  private readonly adminConfigRepository: AdminConfigRepository | null;
  private readonly outboxService: OutboxService | null;

  constructor(
    notificationRepository: NotificationRepository,
    authRepository: AuthRepository | null = null,
    adminConfigRepository: AdminConfigRepository | null = null,
    outboxService: OutboxService | null = null
  ) {
    this.notificationRepository = notificationRepository;
    this.authRepository = authRepository;
    this.adminConfigRepository = adminConfigRepository;
    this.outboxService = outboxService;
  }

  private defaultPreference(userId: string): NotificationPreference {
    return {
      userId,
      inAppEnabled: true,
      emailEnabled: false,
      smsEnabled: false,
      booking: true,
      messages: true,
      community: true
    };
  }

  private async getAdminSettings(): Promise<AdminNotificationSettings> {
    if (!this.adminConfigRepository) {
      return defaultAdminNotificationSettings();
    }

    const config = await this.adminConfigRepository.getConfig();
    if (!config) {
      return defaultAdminNotificationSettings();
    }
    return normalizeAdminNotificationSettings(config.notificationSettings);
  }

  private async requireAuthorizedAccess(
    actorId: string,
    targetUserId: string
  ): Promise<AuthenticatedUser | null> {
    if (!actorId || !targetUserId) {
      throw new Error('Unauthorized');
    }

    if (!this.authRepository) {
      if (actorId !== targetUserId) {
        throw new Error('Forbidden');
      }
      return null;
    }

    const actor = await this.authRepository.findUserById(actorId);
    if (!actor || !actor.isActive) {
      throw new Error('Unauthorized');
    }

    if (actor.role !== 'admin' && actor.id !== targetUserId) {
      throw new Error('Forbidden');
    }

    const target = await this.authRepository.findUserById(targetUserId);
    if (!target || !target.isActive) {
      throw new Error('Unauthorized');
    }

    return actor;
  }

  async getNotificationPreference(actorId: string, userId: string): Promise<NotificationPreference> {
    await this.requireAuthorizedAccess(actorId, userId);
    const stored = await this.notificationRepository.getPreference(userId);
    if (stored) {
      const normalized: NotificationPreference = {
        ...stored,
        inAppEnabled: true,
        booking: stored.booking !== false,
        messages: stored.messages !== false,
        community: stored.community !== false
      };
      if (stored.inAppEnabled !== true) {
        await this.notificationRepository.savePreference(normalized);
      }
      return normalized;
    }

    const preference = this.defaultPreference(userId);
    await this.notificationRepository.savePreference(preference);
    return preference;
  }

  async updateNotificationPreference(
    actorId: string,
    userId: string,
    updates: Partial<
      Pick<
        NotificationPreference,
        'inAppEnabled' | 'emailEnabled' | 'smsEnabled' | 'booking' | 'messages' | 'community'
      >
    >
  ): Promise<NotificationPreference> {
    await this.requireAuthorizedAccess(actorId, userId);
    const current = await this.getNotificationPreference(actorId, userId);
    const updated: NotificationPreference = {
      ...current,
      inAppEnabled: true,
      ...(typeof updates.emailEnabled === 'boolean' ? { emailEnabled: updates.emailEnabled } : {}),
      ...(typeof updates.smsEnabled === 'boolean' ? { smsEnabled: updates.smsEnabled } : {}),
      ...(typeof updates.booking === 'boolean' ? { booking: updates.booking } : {}),
      ...(typeof updates.messages === 'boolean' ? { messages: updates.messages } : {}),
      ...(typeof updates.community === 'boolean' ? { community: updates.community } : {})
    };

    await this.notificationRepository.savePreference(updated);
    return updated;
  }

  async createNotification(
    userId: string,
    type: string,
    message: string,
    metadata: Record<string, unknown> | null = null,
    dedupKey: string | null = null
  ): Promise<Notification | null> {
    if (!userId || !type || !message) {
      return null;
    }

    const notificationType = resolveNotificationType(type);
    const adminSettings = await this.getAdminSettings();
    if (!adminSettings[notificationType]) {
      return null;
    }

    if (this.authRepository) {
      const recipient = await this.authRepository.findUserById(userId);
      if (!recipient || !recipient.isActive) {
        return null;
      }

      const userPreferences = normalizeUserNotificationPreferences(recipient.notificationPreferences);
      if (!userPreferences[notificationType]) {
        return null;
      }

      const actorId = typeof metadata?.actorId === 'string' ? metadata.actorId : null;
      if (actorId && actorId !== userId) {
        const actor = await this.authRepository.findUserById(actorId);
        if (
          recipient.blockedUserIds.includes(actorId) ||
          (actor ? actor.blockedUserIds.includes(userId) : false)
        ) {
          return null;
        }
      }
    }

    let preference = await this.notificationRepository.getPreference(userId);
    if (!preference) {
      preference = this.defaultPreference(userId);
      await this.notificationRepository.savePreference(preference);
    }
    if (!preference.inAppEnabled) {
      preference = {
        ...preference,
        inAppEnabled: true
      };
      await this.notificationRepository.savePreference(preference);
    }

    if (dedupKey) {
      const exists = await this.notificationRepository.existsByDedupKey(dedupKey);
      if (exists) {
        return null;
      }
    }

    const createdAt = nowMs();
    const dayStart = startOfDay(createdAt);
    const dayEnd = endOfDay(createdAt);
    const existingTodayCount = (await this.notificationRepository.getByUser(userId)).filter(
      (notification) =>
        notification.type === type &&
        notification.createdAt >= dayStart &&
        notification.createdAt <= dayEnd
    ).length;

    if (existingTodayCount >= MAX_NOTIFICATIONS_PER_TYPE_PER_DAY) {
      return null;
    }

    const notification: Notification = {
      id: createId(),
      userId,
      type,
      message,
      metadata,
      read: false,
      createdAt,
      dedupKey
    };

    await this.notificationRepository.create(notification);
    if (this.outboxService) {
      await this.outboxService.enqueue({
        type: 'notification.created',
        payload: {
          notificationId: notification.id,
          userId: notification.userId,
          notificationType: notification.type,
          dedupKey: notification.dedupKey,
          createdAt: notification.createdAt
        },
        idempotencyKey: `notification-created-${notification.id}`
      });
    }
    emitNotificationChanged(userId);
    return notification;
  }

  async getUserNotifications(actorId: string, userId: string): Promise<Notification[]> {
    await this.requireAuthorizedAccess(actorId, userId);
    return this.notificationRepository.getByUser(userId);
  }

  async markAsRead(actorId: string, notificationId: string): Promise<void> {
    const target = await this.notificationRepository.getById(notificationId);
    if (!target) {
      return;
    }
    await this.requireAuthorizedAccess(actorId, target.userId);

    await this.notificationRepository.markAsRead(notificationId);
    emitNotificationChanged(target.userId);
  }

  async markAllAsRead(actorId: string, userId: string): Promise<void> {
    await this.requireAuthorizedAccess(actorId, userId);
    await this.notificationRepository.markAllAsRead(userId);
    emitNotificationChanged(userId);
  }

  async getUnreadCount(actorId: string, userId: string): Promise<number> {
    await this.requireAuthorizedAccess(actorId, userId);
    const notifications = await this.notificationRepository.getByUser(userId);
    return notifications.filter((notification) => !notification.read).length;
  }
}

export function createNotificationService(
  notificationRepository: NotificationRepository,
  authRepository: AuthRepository | null = null,
  adminConfigRepository: AdminConfigRepository | null = null,
  outboxService: OutboxService | null = null
): NotificationService {
  return new LocalNotificationService(
    notificationRepository,
    authRepository,
    adminConfigRepository,
    outboxService
  );
}
