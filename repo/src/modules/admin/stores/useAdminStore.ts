import { getAuthService } from '@/app/providers/authProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { User, UserRole } from '@/app/types/domain';
import { defineStore } from 'pinia';

interface AdminState {
  users: User[];
  isLoading: boolean;
  isSubmitting: boolean;
  errorMessage: string;
}

function sortUsers(users: User[]): User[] {
  return [...users].sort((left, right) => left.username.localeCompare(right.username));
}

export const useAdminStore = defineStore('admin', {
  state: (): AdminState => ({
    users: [],
    isLoading: false,
    isSubmitting: false,
    errorMessage: ''
  }),

  getters: {
    activeUserCount(state): number {
      return state.users.filter((user) => user.isActive).length;
    }
  },

  actions: {
    clearError(): void {
      this.errorMessage = '';
    },

    resolveAdminId(): string {
      const authStore = useAuthStore();
      const adminId = authStore.currentUser?.id;

      if (!adminId) {
        throw new Error('Admin session is required.');
      }

      return adminId;
    },

    upsertUser(updated: User): void {
      const existingIndex = this.users.findIndex((user) => user.id === updated.id);
      if (existingIndex === -1) {
        this.users = sortUsers([...this.users, updated]);
        return;
      }

      const nextUsers = [...this.users];
      nextUsers[existingIndex] = updated;
      this.users = sortUsers(nextUsers);
    },

    async fetchUsers(): Promise<void> {
      this.isLoading = true;
      this.errorMessage = '';

      try {
        const adminId = this.resolveAdminId();
        const users = await getAuthService().getAllUsers(adminId);
        this.users = sortUsers(users);
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to load users.';
        throw error;
      } finally {
        this.isLoading = false;
      }
    },

    async changeRole(userId: string, role: UserRole): Promise<void> {
      this.isSubmitting = true;
      this.errorMessage = '';

      try {
        const adminId = this.resolveAdminId();
        const updated = await getAuthService().changeUserRole(adminId, userId, role);
        this.upsertUser(updated);
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to change role.';
        throw error;
      } finally {
        this.isSubmitting = false;
      }
    },

    async toggleUserActive(userId: string): Promise<void> {
      const targetUser = this.users.find((user) => user.id === userId);
      if (!targetUser) {
        this.errorMessage = 'User not found.';
        return;
      }

      this.isSubmitting = true;
      this.errorMessage = '';

      try {
        const adminId = this.resolveAdminId();
        const updated = await getAuthService().setUserActiveStatus(adminId, userId, !targetUser.isActive);
        this.upsertUser(updated);
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to update user status.';
        throw error;
      } finally {
        this.isSubmitting = false;
      }
    },

    async createUser(username: string, password: string, role: UserRole): Promise<void> {
      this.isSubmitting = true;
      this.errorMessage = '';

      try {
        const adminId = this.resolveAdminId();
        const createdUser = await getAuthService().createUserByAdmin(adminId, username, password, role);
        this.users = sortUsers([...this.users, createdUser]);
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to create user.';
        throw error;
      } finally {
        this.isSubmitting = false;
      }
    }
  }
});
