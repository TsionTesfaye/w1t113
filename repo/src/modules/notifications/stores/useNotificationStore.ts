import { getNotificationService } from '@/app/providers/notificationProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { Notification } from '@/app/types/domain';
import { subscribeNotificationChanged } from '@/services/notificationEvents';
import { defineStore } from 'pinia';

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  isSubmitting: boolean;
  errorMessage: string;
  initializedForUserId: string | null;
}

let unsubscribeFromNotificationEvents: (() => void) | null = null;

export const useNotificationStore = defineStore('notifications', {
  state: (): NotificationState => ({
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    isSubmitting: false,
    errorMessage: '',
    initializedForUserId: null
  }),

  getters: {
    hasUnread(state): boolean {
      return state.unreadCount > 0;
    }
  },

  actions: {
    resolveCurrentUserId(): string | null {
      const authStore = useAuthStore();
      return authStore.currentUser?.id ?? null;
    },

    clearState(): void {
      this.notifications = [];
      this.unreadCount = 0;
      this.errorMessage = '';
      this.initializedForUserId = null;
    },

    startListening(): void {
      if (unsubscribeFromNotificationEvents) {
        return;
      }

      unsubscribeFromNotificationEvents = subscribeNotificationChanged((detail) => {
        const userId = this.resolveCurrentUserId();
        if (!userId || detail.userId !== userId) {
          return;
        }

        void this.refresh();
      });
    },

    stopListening(): void {
      if (!unsubscribeFromNotificationEvents) {
        return;
      }

      unsubscribeFromNotificationEvents();
      unsubscribeFromNotificationEvents = null;
    },

    async initialize(force = false): Promise<void> {
      const userId = this.resolveCurrentUserId();
      if (!userId) {
        this.stopListening();
        this.clearState();
        return;
      }

      this.startListening();

      if (!force && this.initializedForUserId === userId && this.notifications.length > 0) {
        await this.refreshUnreadCount();
        return;
      }

      await this.refresh();
      this.initializedForUserId = userId;
    },

    async refresh(): Promise<void> {
      const userId = this.resolveCurrentUserId();
      if (!userId) {
        this.stopListening();
        this.clearState();
        return;
      }

      this.isLoading = true;
      this.errorMessage = '';

      try {
        const notificationService = getNotificationService();
        const notifications = await notificationService.getUserNotifications(userId, userId);

        this.notifications = notifications;
        this.unreadCount = notifications.filter((notification) => !notification.read).length;
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to load notifications.';
      } finally {
        this.isLoading = false;
      }
    },

    async refreshUnreadCount(): Promise<void> {
      const userId = this.resolveCurrentUserId();
      if (!userId) {
        this.unreadCount = 0;
        return;
      }

      try {
        this.unreadCount = await getNotificationService().getUnreadCount(userId, userId);
      } catch {
        // Ignore unread refresh failures to avoid UI flicker.
      }
    },

    async markAsRead(notificationId: string): Promise<void> {
      const userId = this.resolveCurrentUserId();
      if (!userId) {
        return;
      }

      this.isSubmitting = true;
      this.errorMessage = '';

      try {
        await getNotificationService().markAsRead(userId, notificationId);
        this.notifications = this.notifications.map((notification) => {
          if (notification.id !== notificationId) {
            return notification;
          }

          return {
            ...notification,
            read: true
          };
        });

        this.unreadCount = this.notifications.filter((notification) => !notification.read).length;
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to mark notification as read.';
      } finally {
        this.isSubmitting = false;
      }
    },

    async markAllAsRead(): Promise<void> {
      const userId = this.resolveCurrentUserId();
      if (!userId) {
        return;
      }

      this.isSubmitting = true;
      this.errorMessage = '';

      try {
        await getNotificationService().markAllAsRead(userId, userId);
        this.notifications = this.notifications.map((notification) => ({
          ...notification,
          read: true
        }));
        this.unreadCount = 0;
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to mark all notifications as read.';
      } finally {
        this.isSubmitting = false;
      }
    }
  }
});
