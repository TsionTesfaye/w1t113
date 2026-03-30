<script setup lang="ts">
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { User, UserRole } from '@/app/types/domain';
import AppCard from '@/components/AppCard.vue';
import AppModal from '@/components/AppModal.vue';
import { useAdminStore } from '@/modules/admin/stores/useAdminStore';
import { useSearchStore } from '@/modules/search/stores/useSearchStore';
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

interface CreateUserFormState {
  username: string;
  password: string;
  role: UserRole;
}

interface PendingRoleChange {
  userId: string;
  username: string;
  nextRole: UserRole;
}

interface PendingStatusChange {
  userId: string;
  username: string;
  nextIsActive: boolean;
}

const authStore = useAuthStore();
const adminStore = useAdminStore();
const searchStore = useSearchStore();
const { users, isLoading, isSubmitting, errorMessage } = storeToRefs(adminStore);
const {
  results: searchResults,
  isLoading: isSearchLoading,
  errorMessage: searchErrorMessage
} = storeToRefs(searchStore);

const roleOptions: UserRole[] = ['client', 'photographer', 'moderator', 'admin'];
const localMessage = ref('');
const userSearchQuery = ref('');
const pendingRoleChange = ref<PendingRoleChange | null>(null);
const pendingStatusChange = ref<PendingStatusChange | null>(null);
let userSearchDebounceId: number | null = null;
const createForm = reactive<CreateUserFormState>({
  username: '',
  password: '',
  role: 'photographer'
});

const currentUserId = computed(() => authStore.currentUser?.id ?? null);
const isAdminViewer = computed(() =>
  Boolean(
    authStore.currentUser &&
      authStore.currentUser.role === 'admin' &&
      authStore.currentUser.isActive
  )
);
const activeCount = computed(() => users.value.filter((user) => user.isActive).length);
const disabledCount = computed(() => users.value.filter((user) => !user.isActive).length);
const adminCount = computed(() => users.value.filter((user) => user.role === 'admin').length);
const hasUserSearchQuery = computed(() => userSearchQuery.value.trim().length > 0);
const matchedUserIds = computed(() => new Set(searchResults.value.map((result) => result.entityId)));
const searchResultByUserId = computed(
  () => new Map(searchResults.value.map((result) => [result.entityId, result]))
);
const visibleUsers = computed(() => {
  if (!hasUserSearchQuery.value) {
    return users.value;
  }

  return users.value.filter((user) => matchedUserIds.value.has(user.id));
});

const usernameValidationError = computed(() => {
  if (!createForm.username.trim()) {
    return 'Username is required';
  }

  return '';
});

const passwordValidationError = computed(() => {
  if (!createForm.password) {
    return 'Password is required';
  }

  if (createForm.password.length < 8) {
    return 'Password must be at least 8 characters';
  }

  return '';
});

const canSubmitCreateUser = computed(
  () =>
    isAdminViewer.value &&
    !usernameValidationError.value &&
    !passwordValidationError.value &&
    Boolean(createForm.role)
);

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function roleBadgeClass(role: UserRole): string {
  if (role === 'admin') {
    return 'pill pill--role-admin';
  }

  if (role === 'moderator') {
    return 'pill pill--role-moderator';
  }

  if (role === 'photographer') {
    return 'pill pill--role-photographer';
  }

  return 'pill pill--role-client';
}

function canManageTarget(user: User): boolean {
  if (!isAdminViewer.value) {
    return false;
  }

  if (currentUserId.value === user.id) {
    return false;
  }

  return true;
}

async function loadUsers(): Promise<void> {
  localMessage.value = '';

  try {
    await adminStore.fetchUsers();
  } catch {
    // Error state is surfaced through adminStore.errorMessage.
  }
}

async function handleRoleChange(user: User, event: Event): Promise<void> {
  const target = event.target as HTMLSelectElement;
  const nextRole = target.value as UserRole;

  if (nextRole === user.role) {
    return;
  }

  target.value = user.role;
  pendingRoleChange.value = {
    userId: user.id,
    username: user.username,
    nextRole
  };
}

function closeRoleChangeModal(): void {
  pendingRoleChange.value = null;
}

async function confirmRoleChange(): Promise<void> {
  if (!pendingRoleChange.value) {
    return;
  }

  localMessage.value = '';
  try {
    await adminStore.changeRole(pendingRoleChange.value.userId, pendingRoleChange.value.nextRole);
    localMessage.value = 'Role updated successfully.';
    closeRoleChangeModal();
  } catch {
    // Error state is surfaced through adminStore.errorMessage.
  }
}

async function handleToggleActive(user: User): Promise<void> {
  if (!canManageTarget(user)) {
    return;
  }

  pendingStatusChange.value = {
    userId: user.id,
    username: user.username,
    nextIsActive: !user.isActive
  };
}

function closeStatusChangeModal(): void {
  pendingStatusChange.value = null;
}

async function confirmStatusChange(): Promise<void> {
  if (!pendingStatusChange.value) {
    return;
  }

  localMessage.value = '';
  try {
    await adminStore.toggleUserActive(pendingStatusChange.value.userId);
    localMessage.value = `User ${
      pendingStatusChange.value.nextIsActive ? 'enabled' : 'disabled'
    } successfully.`;
    closeStatusChangeModal();
  } catch {
    // Error state is surfaced through adminStore.errorMessage.
  }
}

async function handleCreateUser(): Promise<void> {
  localMessage.value = '';

  if (!canSubmitCreateUser.value) {
    return;
  }

  try {
    await adminStore.createUser(createForm.username, createForm.password, createForm.role);
    localMessage.value = 'User created successfully.';
    createForm.username = '';
    createForm.password = '';
    createForm.role = 'photographer';
  } catch {
    // Error state is surfaced through adminStore.errorMessage.
  }
}

onMounted(() => {
  searchStore.clear();
  void loadUsers();
});

watch(userSearchQuery, (query) => {
  if (userSearchDebounceId !== null) {
    window.clearTimeout(userSearchDebounceId);
  }

  userSearchDebounceId = window.setTimeout(() => {
    void searchStore.search({ query, type: 'user' });
  }, 300);
});

onBeforeUnmount(() => {
  if (userSearchDebounceId !== null) {
    window.clearTimeout(userSearchDebounceId);
    userSearchDebounceId = null;
  }
});
</script>

<template>
  <section class="page-stack">
    <div class="page-header">
      <div>
        <h2>User Management</h2>
      </div>
    </div>

    <div class="stat-grid">
      <AppCard title="Total users">
        <p class="metric-value">{{ users.length }}</p>
      </AppCard>
      <AppCard title="Active users">
        <p class="metric-value">{{ activeCount }}</p>
      </AppCard>
      <AppCard title="Admins">
        <p class="metric-value">{{ adminCount }}</p>
      </AppCard>
    </div>

    <div class="content-grid content-grid--2">
      <AppCard title="Create User">
        <form class="admin-user-form" @submit.prevent="handleCreateUser">
          <label class="field">
            <span class="field__label">Username</span>
            <input
              v-model="createForm.username"
              class="input"
              name="username"
              autocomplete="off"
              placeholder="Enter username"
              :disabled="!isAdminViewer || isSubmitting"
            />
            <span class="field__error">{{ usernameValidationError }}</span>
          </label>

          <label class="field">
            <span class="field__label">Password</span>
            <input
              v-model="createForm.password"
              class="input"
              type="password"
              name="password"
              autocomplete="new-password"
              placeholder="Enter temporary password"
              :disabled="!isAdminViewer || isSubmitting"
            />
            <span class="field__error">{{ passwordValidationError }}</span>
          </label>

          <label class="field">
            <span class="field__label">Role</span>
            <select v-model="createForm.role" class="input" :disabled="!isAdminViewer || isSubmitting">
              <option v-for="role in roleOptions" :key="role" :value="role">
                {{ role }}
              </option>
            </select>
          </label>

          <button type="submit" class="btn btn--primary" :disabled="!canSubmitCreateUser || isSubmitting">
            {{ isSubmitting ? 'Creating...' : 'Create user' }}
          </button>
        </form>
      </AppCard>

      <AppCard title="Overview">
        <div class="admin-overview">
          <p class="muted">
            Disabled accounts: <strong>{{ disabledCount }}</strong>
          </p>
          <p v-if="!isAdminViewer" class="form-error">Only active admins can manage users.</p>
        </div>
      </AppCard>
    </div>

    <AppCard title="Users">
      <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
      <p v-else-if="localMessage" class="admin-success">{{ localMessage }}</p>

      <div class="context-search-row">
        <input
          v-model="userSearchQuery"
          class="input"
          type="search"
          placeholder="Search users..."
        />
        <button
          v-if="hasUserSearchQuery"
          type="button"
          class="btn btn--ghost"
          @click="userSearchQuery = ''"
        >
          Clear
        </button>
        <button
          type="button"
          class="btn btn--outline"
          :disabled="isSearchLoading"
          @click="searchStore.rebuildIndex()"
        >
          Rebuild index
        </button>
      </div>
      <p v-if="searchErrorMessage" class="form-error">{{ searchErrorMessage }}</p>

      <div v-if="isLoading" class="empty-state">
        <p class="muted">Loading users...</p>
      </div>

      <div v-else-if="visibleUsers.length === 0" class="empty-state">
        <p class="muted">{{ hasUserSearchQuery ? 'No results found' : 'No users found.' }}</p>
      </div>

      <div v-else class="list-table admin-user-table">
        <div class="user-table-row user-table-row--head">
          <span>Username</span>
          <span>Role</span>
          <span>Status</span>
          <span>Created At</span>
          <span>Actions</span>
        </div>

        <div
          v-for="user in visibleUsers"
          :key="user.id"
          class="user-table-row"
          :class="{ 'is-disabled': !user.isActive }"
        >
          <span class="user-table-cell">
            <strong>{{ user.username }}</strong>
            <small
              v-if="hasUserSearchQuery && searchResultByUserId.get(user.id)?.highlightedExcerpt"
              class="search-result-snippet"
              v-html="searchResultByUserId.get(user.id)?.highlightedExcerpt"
            />
          </span>

          <span class="user-table-cell">
            <span :class="roleBadgeClass(user.role)">
              {{ user.role }}
            </span>
          </span>

          <span class="user-table-cell">
            <span class="pill" :class="user.isActive ? 'pill--success' : 'pill--warning'">
              {{ user.isActive ? 'Active' : 'Disabled' }}
            </span>
          </span>

          <span class="user-table-cell">{{ formatTimestamp(user.createdAt) }}</span>

          <span class="user-table-cell user-table-actions">
            <select
              class="input user-role-select"
              :value="user.role"
              :disabled="!canManageTarget(user) || isSubmitting"
              @change="handleRoleChange(user, $event)"
            >
              <option v-for="role in roleOptions" :key="role" :value="role">
                {{ role }}
              </option>
            </select>
            <button
              type="button"
              class="btn btn--outline"
              :disabled="!canManageTarget(user) || isSubmitting"
              @click="handleToggleActive(user)"
            >
              {{ user.isActive ? 'Disable' : 'Enable' }}
            </button>
          </span>
        </div>
      </div>
    </AppCard>
  </section>

  <AppModal
    :open="Boolean(pendingRoleChange)"
    title="Confirm role change"
    :message="
      pendingRoleChange
        ? `Change ${pendingRoleChange.username}'s role to ${pendingRoleChange.nextRole}?`
        : ''
    "
    confirm-text="Change role"
    :loading="isSubmitting"
    @cancel="closeRoleChangeModal"
    @confirm="confirmRoleChange"
  />

  <AppModal
    :open="Boolean(pendingStatusChange)"
    title="Confirm account status"
    :message="
      pendingStatusChange
        ? `${pendingStatusChange.nextIsActive ? 'Enable' : 'Disable'} ${pendingStatusChange.username}?`
        : ''
    "
    :confirm-text="pendingStatusChange?.nextIsActive ? 'Enable' : 'Disable'"
    :confirm-variant="pendingStatusChange?.nextIsActive ? 'primary' : 'danger'"
    :loading="isSubmitting"
    @cancel="closeStatusChangeModal"
    @confirm="confirmStatusChange"
  />
</template>
