import { getAuthService } from '@/app/providers/authProvider';
import type { User, UserNotificationPreferences } from '@/app/types/domain';
import type { AuthenticatedSession } from '@/services/AuthService';
import { defineStore } from 'pinia';

interface AuthState {
  currentUser: User | null;
  hasActiveEncryptionKey: boolean;
  sessionLoaded: boolean;
  bootstrapRequired: boolean;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    currentUser: null,
    hasActiveEncryptionKey: false,
    sessionLoaded: false,
    bootstrapRequired: false
  }),

  getters: {
    isAuthenticated: (state): boolean => Boolean(state.currentUser)
  },

  actions: {
    async clearUserScopedStores(): Promise<void> {
      const [
        { useBookingStore },
        { useMyBookingsStore },
        { useMessageStore },
        { useHealthFormsStore },
        { useNotificationStore },
        { useCommunityStore },
        { usePhotographerStore },
        { useSearchStore },
        { useAdminBookingStore },
        { useAdminStore },
        { useImportExportStore },
        { useAdminConfigStore },
        { useProfileSettingsStore }
      ] = await Promise.all([
        import('@/modules/booking/stores/useBookingStore'),
        import('@/modules/booking/stores/useMyBookingsStore'),
        import('@/modules/messaging/stores/useMessageStore'),
        import('@/modules/healthForms/stores/useHealthFormsStore'),
        import('@/modules/notifications/stores/useNotificationStore'),
        import('@/modules/community/stores/useCommunityStore'),
        import('@/modules/photographer/stores/usePhotographerStore'),
        import('@/modules/search/stores/useSearchStore'),
        import('@/modules/admin/stores/useAdminBookingStore'),
        import('@/modules/admin/stores/useAdminStore'),
        import('@/modules/admin/stores/useImportExportStore'),
        import('@/modules/admin/stores/useAdminConfigStore'),
        import('@/app/stores/useProfileSettingsStore')
      ]);

      const bookingStore = useBookingStore();
      bookingStore.stopLockTicker();
      bookingStore.$reset();

      useMyBookingsStore().$reset();

      const messageStore = useMessageStore();
      messageStore.stopListening();
      messageStore.$reset();

      useHealthFormsStore().$reset();
      useNotificationStore().$reset();
      useCommunityStore().$reset();
      usePhotographerStore().$reset();

      const searchStore = useSearchStore();
      searchStore.clear();
      searchStore.$reset();

      useAdminBookingStore().$reset();
      useAdminStore().$reset();
      useImportExportStore().$reset();
      useAdminConfigStore().$reset();
      useProfileSettingsStore().$reset();
    },

    async register(username: string, password: string, confirmPassword: string): Promise<void> {
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }

      const authService = getAuthService();
      await authService.register(username, password);
    },

    async checkInitialAdminSetup(): Promise<void> {
      const authService = getAuthService();
      this.bootstrapRequired = await authService.isInitialAdminSetupRequired();
    },

    async bootstrapInitialAdmin(
      username: string,
      password: string,
      confirmPassword: string
    ): Promise<void> {
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }

      const authService = getAuthService();
      await authService.bootstrapInitialAdmin(username, password);
      this.bootstrapRequired = false;
    },

    async login(username: string, password: string, rememberMe = false): Promise<void> {
      const authService = getAuthService();
      const session = await authService.login({ username, password, rememberMe });
      await this.applySession(session);
      this.sessionLoaded = true;
    },

    async logout(): Promise<void> {
      const authService = getAuthService();
      await authService.logout();
      await this.clearUserScopedStores();
      this.currentUser = null;
      this.hasActiveEncryptionKey = false;
      this.sessionLoaded = true;
    },

    async loadSession(): Promise<void> {
      const authService = getAuthService();
      const session = await authService.loadSession();
      await this.applySession(session);
      this.sessionLoaded = true;
    },

    async ensureSessionLoaded(): Promise<void> {
      if (this.sessionLoaded) {
        return;
      }

      await this.loadSession();
    },

    getEncryptionKey(): CryptoKey | null {
      return getAuthService().getActiveEncryptionKey();
    },

    async updateProfile(username: string): Promise<void> {
      const currentUserId = this.currentUser?.id;
      if (!currentUserId) {
        throw new Error('You must be signed in.');
      }

      const updated = await getAuthService().updateUser(currentUserId, currentUserId, { username });
      this.currentUser = updated;
    },

    async updateNotificationPreferences(
      updates: Partial<UserNotificationPreferences>
    ): Promise<void> {
      const currentUserId = this.currentUser?.id;
      if (!currentUserId) {
        throw new Error('You must be signed in.');
      }

      const updated = await getAuthService().updateNotificationPreferences(
        currentUserId,
        currentUserId,
        updates
      );
      this.currentUser = updated;
    },

    async blockUser(targetUserId: string): Promise<void> {
      const currentUserId = this.currentUser?.id;
      if (!currentUserId) {
        throw new Error('You must be signed in.');
      }

      const updated = await getAuthService().blockUser(currentUserId, targetUserId);
      this.currentUser = updated;
    },

    async unblockUser(targetUserId: string): Promise<void> {
      const currentUserId = this.currentUser?.id;
      if (!currentUserId) {
        throw new Error('You must be signed in.');
      }

      const updated = await getAuthService().unblockUser(currentUserId, targetUserId);
      this.currentUser = updated;
    },

    async applySession(session: AuthenticatedSession | null): Promise<void> {
      const previousUserId = this.currentUser?.id ?? null;
      const nextUserId = session?.user.id ?? null;
      const didUserChange = previousUserId !== nextUserId;

      if (didUserChange) {
        await this.clearUserScopedStores();
      }

      if (!session) {
        this.currentUser = null;
        this.hasActiveEncryptionKey = false;
        return;
      }

      this.currentUser = session.user;
      this.hasActiveEncryptionKey = session.hasActiveEncryptionKey;
    }
  }
});
