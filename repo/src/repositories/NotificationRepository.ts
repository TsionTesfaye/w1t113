import type { Notification, NotificationPreference } from '@/app/types/domain';
import { indexedDbClient } from '@/db/indexedDbClient';

interface StoredNotificationPreference extends NotificationPreference {
  id: string;
}

export interface NotificationRepository {
  create(notification: Notification): Promise<void>;
  getById(notificationId: string): Promise<Notification | null>;
  getByUser(userId: string): Promise<Notification[]>;
  getPreference(userId: string): Promise<NotificationPreference | null>;
  savePreference(preference: NotificationPreference): Promise<void>;
  markAsRead(notificationId: string): Promise<void>;
  markAllAsRead(userId: string): Promise<void>;
  existsByDedupKey(dedupKey: string): Promise<boolean>;
}

function sortByNewest(notifications: Notification[]): Notification[] {
  return [...notifications].sort((left, right) => right.createdAt - left.createdAt);
}

class IndexedDbNotificationRepository implements NotificationRepository {
  async create(notification: Notification): Promise<void> {
    await indexedDbClient.withTransaction(['notifications'], 'readwrite', async (transaction) => {
      await transaction.put('notifications', notification);
    });
  }

  async getByUser(userId: string): Promise<Notification[]> {
    return indexedDbClient.withTransaction(['notifications'], 'readonly', async (transaction) => {
      const notifications = await transaction.getAllByIndex<Notification>(
        'notifications',
        'userId',
        userId
      );
      return sortByNewest(notifications);
    });
  }

  async getById(notificationId: string): Promise<Notification | null> {
    return indexedDbClient.withTransaction(['notifications'], 'readonly', async (transaction) => {
      const notification = await transaction.get<Notification>('notifications', notificationId);
      return notification ?? null;
    });
  }

  async getPreference(userId: string): Promise<NotificationPreference | null> {
    return indexedDbClient.withTransaction(['notificationPreferences'], 'readonly', async (transaction) => {
      const preference = await transaction.get<StoredNotificationPreference>('notificationPreferences', userId);
      if (!preference) {
        return null;
      }

      const { userId: storedUserId, inAppEnabled, emailEnabled, smsEnabled } = preference;
      return {
        userId: storedUserId,
        inAppEnabled,
        emailEnabled,
        smsEnabled,
        booking: preference.booking !== false,
        messages: preference.messages !== false,
        community: preference.community !== false
      };
    });
  }

  async savePreference(preference: NotificationPreference): Promise<void> {
    await indexedDbClient.withTransaction(['notificationPreferences'], 'readwrite', async (transaction) => {
      const storedPreference: StoredNotificationPreference = {
        id: preference.userId,
        ...preference
      };
      await transaction.put('notificationPreferences', storedPreference);
    });
  }

  async markAsRead(notificationId: string): Promise<void> {
    await indexedDbClient.withTransaction(['notifications'], 'readwrite', async (transaction) => {
      const notification = await transaction.get<Notification>('notifications', notificationId);
      if (!notification || notification.read) {
        return;
      }

      await transaction.put('notifications', {
        ...notification,
        read: true
      });
    });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await indexedDbClient.withTransaction(['notifications'], 'readwrite', async (transaction) => {
      const notifications = await transaction.getAllByIndex<Notification>(
        'notifications',
        'userId',
        userId
      );

      for (const notification of notifications) {
        if (notification.read) {
          continue;
        }

        await transaction.put('notifications', {
          ...notification,
          read: true
        });
      }
    });
  }

  async existsByDedupKey(dedupKey: string): Promise<boolean> {
    if (!dedupKey) {
      return false;
    }

    return indexedDbClient.withTransaction(['notifications'], 'readonly', async (transaction) => {
      const existing = await transaction.getByIndex<Notification>(
        'notifications',
        'dedupKey',
        dedupKey
      );
      return Boolean(existing);
    });
  }
}

export function createNotificationRepository(): NotificationRepository {
  return new IndexedDbNotificationRepository();
}
