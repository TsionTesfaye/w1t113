import { getAdminConfigService } from '@/app/providers/adminConfigProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { AdminNotificationSettings } from '@/app/types/domain';
import { defineStore } from 'pinia';

interface AdminConfigState {
  notificationSettings: AdminNotificationSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  errorMessage: string;
  successMessage: string;
}

export const useAdminConfigStore = defineStore('adminConfig', {
  state: (): AdminConfigState => ({
    notificationSettings: null,
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

    resolveUserId(): string {
      const userId = useAuthStore().currentUser?.id;
      if (!userId) {
        throw new Error('Authentication is required.');
      }

      return userId;
    },

    async loadConfig(): Promise<void> {
      this.isLoading = true;
      this.clearFeedback();

      try {
        const userId = this.resolveUserId();
        const config = await getAdminConfigService().getConfig(userId);
        this.notificationSettings = config.notificationSettings;
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to load configuration.';
      } finally {
        this.isLoading = false;
      }
    },

    async updateNotificationSettings(
      updates: Partial<AdminNotificationSettings>
    ): Promise<void> {
      this.isSaving = true;
      this.clearFeedback();

      try {
        const userId = this.resolveUserId();
        const config = await getAdminConfigService().updateNotificationSettings(userId, updates);
        this.notificationSettings = config.notificationSettings;
        this.successMessage = 'Configuration saved.';
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to save configuration.';
        throw error;
      } finally {
        this.isSaving = false;
      }
    }
  }
});
