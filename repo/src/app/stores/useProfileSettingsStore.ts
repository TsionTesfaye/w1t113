import { getAdminConfigService } from '@/app/providers/adminConfigProvider';
import { getAuthService } from '@/app/providers/authProvider';
import { getNotificationService } from '@/app/providers/notificationProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type {
  AdminNotificationSettings,
  NotificationPreference,
  User,
  UserNotificationPreferences
} from '@/app/types/domain';
import { defineStore } from 'pinia';

interface ProfileSettingsState {
  blockedUsers: User[];
  adminNotificationSettings: AdminNotificationSettings | null;
  notificationPreference: NotificationPreference | null;
  isLoading: boolean;
  isSaving: boolean;
  errorMessage: string;
  successMessage: string;
}

function defaultAdminNotificationSettings(): AdminNotificationSettings {
  return {
    booking: true,
    messages: true,
    community: true
  };
}

export const useProfileSettingsStore = defineStore('profileSettings', {
  state: (): ProfileSettingsState => ({
    blockedUsers: [],
    adminNotificationSettings: null,
    notificationPreference: null,
    isLoading: false,
    isSaving: false,
    errorMessage: '',
    successMessage: ''
  }),

  actions: {
    clearFeedback(): void {
      this.errorMessage = '';
      this.successMessage = '';
    },

    resolveCurrentUserId(): string {
      const userId = useAuthStore().currentUser?.id;
      if (!userId) {
        throw new Error('Authentication is required.');
      }

      return userId;
    },

    async initialize(force = false): Promise<void> {
      if (!force && this.adminNotificationSettings) {
        return;
      }

      this.isLoading = true;
      this.clearFeedback();

      try {
        const userId = this.resolveCurrentUserId();
        const authStore = useAuthStore();
        const blockedUsersPromise = getAuthService().getBlockedUsers(userId, userId);
        const preferencePromise = getNotificationService().getNotificationPreference(userId, userId);
        const adminConfigPromise =
          authStore.currentUser?.role === 'admin'
            ? getAdminConfigService().getConfig(userId)
            : Promise.resolve(null);
        const [adminConfig, blockedUsers, notificationPreference] = await Promise.all([
          adminConfigPromise,
          blockedUsersPromise,
          preferencePromise
        ]);

        this.adminNotificationSettings = adminConfig?.notificationSettings ?? defaultAdminNotificationSettings();
        this.blockedUsers = blockedUsers;
        this.notificationPreference = notificationPreference;
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to load profile settings.';
      } finally {
        this.isLoading = false;
      }
    },

    async refreshBlockedUsers(): Promise<void> {
      this.clearFeedback();
      try {
        const userId = this.resolveCurrentUserId();
        this.blockedUsers = await getAuthService().getBlockedUsers(userId, userId);
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to load blocked users.';
      }
    },

    async updateNotificationPreferences(
      updates: Partial<UserNotificationPreferences>
    ): Promise<void> {
      this.isSaving = true;
      this.clearFeedback();

      try {
        await useAuthStore().updateNotificationPreferences(updates);
        const userId = this.resolveCurrentUserId();
        this.notificationPreference = await getNotificationService().getNotificationPreference(
          userId,
          userId
        );
        this.successMessage = 'Notification preferences saved.';
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to save notification preferences.';
        throw error;
      } finally {
        this.isSaving = false;
      }
    },

    async updateNotificationChannels(
      updates: Partial<Pick<NotificationPreference, 'inAppEnabled' | 'emailEnabled' | 'smsEnabled'>>
    ): Promise<void> {
      this.isSaving = true;
      this.clearFeedback();

      try {
        const userId = this.resolveCurrentUserId();
        this.notificationPreference = await getNotificationService().updateNotificationPreference(
          userId,
          userId,
          {
            ...updates,
            inAppEnabled: true
          }
        );
        this.successMessage = 'Notification channel preferences saved.';
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to save channel preferences.';
        throw error;
      } finally {
        this.isSaving = false;
      }
    },

    async blockUser(targetUserId: string): Promise<void> {
      this.isSaving = true;
      this.clearFeedback();

      try {
        await useAuthStore().blockUser(targetUserId);
        await this.refreshBlockedUsers();
        this.successMessage = 'User blocked.';
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to block user.';
        throw error;
      } finally {
        this.isSaving = false;
      }
    },

    async blockUserByUsername(username: string): Promise<void> {
      const normalizedUsername = username.trim().toLowerCase();
      if (!normalizedUsername) {
        throw new Error('Username is required.');
      }

      const currentUserId = this.resolveCurrentUserId();
      const target = await getAuthService().findUserByUsername(currentUserId, normalizedUsername);
      if (!target || !target.isActive) {
        throw new Error('User not found.');
      }

      if (target.id === currentUserId) {
        throw new Error('You cannot block yourself.');
      }

      await this.blockUser(target.id);
    },

    async unblockUser(targetUserId: string): Promise<void> {
      this.isSaving = true;
      this.clearFeedback();

      try {
        await useAuthStore().unblockUser(targetUserId);
        await this.refreshBlockedUsers();
        this.successMessage = 'User unblocked.';
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to unblock user.';
        throw error;
      } finally {
        this.isSaving = false;
      }
    }
  }
});
