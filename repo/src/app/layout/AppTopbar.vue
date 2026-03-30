<script setup lang="ts">
import { useAuthStore } from '@/app/stores/useAuthStore';
import { useProfileSettingsStore } from '@/app/stores/useProfileSettingsStore';
import { toUserErrorMessage } from '@/app/utils/errorMessage';
import type { NotificationPreferenceType, SearchResult } from '@/app/types/domain';
import { useNotificationStore } from '@/modules/notifications/stores/useNotificationStore';
import { useSearchStore } from '@/modules/search/stores/useSearchStore';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

defineEmits<{
  'toggle-sidebar': [];
}>();

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const profileSettingsStore = useProfileSettingsStore();
const notificationStore = useNotificationStore();
const searchStore = useSearchStore();
const showProfileModal = ref(false);
const usernameDraft = ref('');
const blockUsernameDraft = ref('');
const profileError = ref('');
const isSavingProfile = ref(false);
const globalSearchQuery = ref('');
const isSearchPanelOpen = ref(false);
let searchDebounceTimerId: number | null = null;
let hideSearchPanelTimerId: number | null = null;

const title = computed(() => route.meta.title ?? 'StudioOps');
const unreadNotificationCount = computed(() => notificationStore.unreadCount);
const currentUsername = computed(() => authStore.currentUser?.username ?? '');
const currentNotificationPreferences = computed(() => {
  return (
    authStore.currentUser?.notificationPreferences ?? {
      booking: true,
      messages: true,
      community: true
    }
  );
});
const blockedUsers = computed(() => profileSettingsStore.blockedUsers);
const adminNotificationSettings = computed(() => {
  return (
    profileSettingsStore.adminNotificationSettings ?? {
      booking: true,
      messages: true,
      community: true
    }
  );
});
const notificationChannels = computed(() => {
  return (
    profileSettingsStore.notificationPreference ?? {
      userId: authStore.currentUser?.id ?? '',
      inAppEnabled: true,
      emailEnabled: false,
      smsEnabled: false,
      booking: true,
      messages: true,
      community: true
    }
  );
});
const avatarInitial = computed(() => {
  const source = currentUsername.value.trim();
  if (!source) {
    return '?';
  }

  return source.charAt(0).toUpperCase();
});
const searchResultGroups = computed(() => {
  const groups: Array<{ title: string; type: SearchResult['type']; items: SearchResult[] }> = [];
  const bookings = searchStore.results.filter((result) => result.type === 'booking');
  const users =
    authStore.currentUser?.role === 'admin'
      ? searchStore.results.filter((result) => result.type === 'user')
      : [];
  const posts = searchStore.results.filter((result) => result.type === 'post');

  if (bookings.length > 0) {
    groups.push({
      title: 'Bookings',
      type: 'booking',
      items: bookings
    });
  }

  if (users.length > 0) {
    groups.push({
      title: 'Users',
      type: 'user',
      items: users
    });
  }

  if (posts.length > 0) {
    groups.push({
      title: 'Community',
      type: 'post',
      items: posts
    });
  }

  return groups;
});
const hasSearchQuery = computed(() => globalSearchQuery.value.trim().length > 0);
const showSearchDropdown = computed(() => isSearchPanelOpen.value && hasSearchQuery.value);
const searchSynonymHint = computed(() => {
  if (!hasSearchQuery.value || !searchStore.matchedSynonym) {
    return '';
  }

  return `Showing results related to "${searchStore.matchedSynonym}"`;
});

async function openProfileModal(): Promise<void> {
  usernameDraft.value = currentUsername.value;
  blockUsernameDraft.value = '';
  profileError.value = '';
  showProfileModal.value = true;
  await profileSettingsStore.initialize(true);
}

async function openNotifications(): Promise<void> {
  await router.push('/notifications');
}

function scheduleGlobalSearch(query: string): void {
  if (searchDebounceTimerId !== null) {
    window.clearTimeout(searchDebounceTimerId);
    searchDebounceTimerId = null;
  }

  const normalized = query.trim();
  if (!normalized) {
    searchStore.clear();
    return;
  }

  searchDebounceTimerId = window.setTimeout(() => {
    void searchStore.search({ query: normalized });
  }, 300);
}

function openSearchPanel(): void {
  if (hideSearchPanelTimerId !== null) {
    window.clearTimeout(hideSearchPanelTimerId);
    hideSearchPanelTimerId = null;
  }

  if (hasSearchQuery.value) {
    isSearchPanelOpen.value = true;
  }
}

function scheduleCloseSearchPanel(): void {
  if (hideSearchPanelTimerId !== null) {
    window.clearTimeout(hideSearchPanelTimerId);
  }

  hideSearchPanelTimerId = window.setTimeout(() => {
    isSearchPanelOpen.value = false;
    hideSearchPanelTimerId = null;
  }, 120);
}

function formatSearchResultSubtitle(result: SearchResult): string {
  if (result.type === 'booking') {
    const client = typeof result.metadata.clientUsername === 'string' ? result.metadata.clientUsername : '';
    const status =
      typeof result.metadata.status === 'string'
        ? result.metadata.status.replace(/_/g, ' ')
        : '';
    const start =
      typeof result.metadata.startTime === 'number'
        ? new Date(result.metadata.startTime).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : '';

    return [client, start, status].filter(Boolean).join(' · ');
  }

  if (result.type === 'user') {
    const role = typeof result.metadata.role === 'string' ? result.metadata.role : 'user';
    const status =
      result.metadata.isActive === false
        ? 'Disabled'
        : 'Active';
    return `${role} · ${status}`;
  }

  if (result.type === 'post') {
    const author =
      typeof result.metadata.authorUsername === 'string' ? result.metadata.authorUsername : 'community';
    return `${author} · ${result.excerpt.replace(/<[^>]+>/g, '')}`;
  }

  return result.excerpt.replace(/<[^>]+>/g, '');
}

function searchResultSnippet(result: SearchResult): string {
  return result.highlightedExcerpt || result.excerpt;
}

async function navigateFromSearchResult(result: SearchResult): Promise<void> {
  isSearchPanelOpen.value = false;
  globalSearchQuery.value = '';
  searchStore.clear();

  if (result.type === 'booking') {
    await router.push(`/bookings/${result.entityId}`);
    return;
  }

  if (result.type === 'user') {
    await router.push(`/users/${result.entityId}`);
    return;
  }

  await router.push({
    name: 'community',
    query: {
      postId: result.entityId
    }
  });
}

function closeProfileModal(): void {
  showProfileModal.value = false;
  profileError.value = '';
}

async function saveProfile(): Promise<void> {
  const username = usernameDraft.value.trim();
  if (!username) {
    profileError.value = 'Username is required.';
    return;
  }

  isSavingProfile.value = true;
  profileError.value = '';

  try {
    await authStore.updateProfile(username);
    closeProfileModal();
  } catch (error: unknown) {
    profileError.value = toUserErrorMessage(error, 'Unable to update profile.');
  } finally {
    isSavingProfile.value = false;
  }
}

function isNotificationTypeDisabledByAdmin(type: NotificationPreferenceType): boolean {
  return adminNotificationSettings.value[type] === false;
}

async function toggleNotificationPreference(type: NotificationPreferenceType, enabled: boolean): Promise<void> {
  profileError.value = '';
  try {
    await profileSettingsStore.updateNotificationPreferences({ [type]: enabled });
  } catch (error: unknown) {
    profileError.value = toUserErrorMessage(error, 'Unable to update preference.');
  }
}

async function blockByUsername(): Promise<void> {
  const username = blockUsernameDraft.value.trim();
  if (!username) {
    profileError.value = 'Enter a username to block.';
    return;
  }

  profileError.value = '';
  try {
    await profileSettingsStore.blockUserByUsername(username);
    blockUsernameDraft.value = '';
  } catch (error: unknown) {
    profileError.value = toUserErrorMessage(error, 'Unable to block user.');
  }
}

async function unblockUser(targetUserId: string): Promise<void> {
  profileError.value = '';
  try {
    await profileSettingsStore.unblockUser(targetUserId);
  } catch (error: unknown) {
    profileError.value = toUserErrorMessage(error, 'Unable to unblock user.');
  }
}

watch(
  () => authStore.currentUser?.id,
  async (userId) => {
    if (showProfileModal.value) {
      usernameDraft.value = currentUsername.value;
    }

    if (!userId) {
      notificationStore.stopListening();
      notificationStore.clearState();
      return;
    }

    await notificationStore.initialize(true);
  },
  { immediate: true }
);

watch(
  () => globalSearchQuery.value,
  (value) => {
    const normalized = value.trim();
    if (!normalized) {
      isSearchPanelOpen.value = false;
      scheduleGlobalSearch('');
      return;
    }

    isSearchPanelOpen.value = true;
    scheduleGlobalSearch(normalized);
  }
);

onBeforeUnmount(() => {
  notificationStore.stopListening();
  if (searchDebounceTimerId !== null) {
    window.clearTimeout(searchDebounceTimerId);
  }
  if (hideSearchPanelTimerId !== null) {
    window.clearTimeout(hideSearchPanelTimerId);
  }
});
</script>

<template>
  <header class="topbar">
    <div class="topbar__left">
      <button
        class="btn btn--ghost topbar__menu"
        type="button"
        aria-label="Toggle sidebar"
        @click="$emit('toggle-sidebar')"
      >
        <span class="topbar__menu-icon" />
      </button>

      <div>
        <h1 class="topbar__title">{{ title }}</h1>
      </div>
    </div>

    <div class="topbar__right">
      <div class="topbar__search">
        <div class="topbar__search-shell" @mousedown="openSearchPanel">
          <input
            v-model="globalSearchQuery"
            type="search"
            class="input topbar__search-input"
            placeholder="Search…"
            @focus="openSearchPanel"
            @blur="scheduleCloseSearchPanel"
          />
          <div v-if="showSearchDropdown" class="topbar-search-dropdown">
            <p v-if="searchStore.isLoading" class="topbar-search-dropdown__state">Searching…</p>
            <p v-else-if="searchStore.errorMessage" class="topbar-search-dropdown__state">
              {{ searchStore.errorMessage }}
            </p>
            <p
              v-else-if="searchResultGroups.length === 0"
              class="topbar-search-dropdown__state"
            >
              No results found. Try different keywords or check spelling.
            </p>
            <template v-else>
              <p v-if="searchSynonymHint" class="topbar-search-dropdown__hint">
                {{ searchSynonymHint }}
              </p>
              <section
                v-for="group in searchResultGroups"
                :key="group.type"
                class="topbar-search-dropdown__group"
              >
                <p class="topbar-search-dropdown__group-title">{{ group.title }}</p>
                <button
                  v-for="result in group.items"
                  :key="result.id"
                  type="button"
                  class="topbar-search-dropdown__item"
                  @mousedown.prevent
                  @click="navigateFromSearchResult(result)"
                >
                  <span class="topbar-search-dropdown__item-title" v-html="result.highlightedTitle" />
                  <span class="topbar-search-dropdown__item-subtitle">
                    {{ formatSearchResultSubtitle(result) }}
                  </span>
                  <span class="topbar-search-dropdown__item-snippet" v-html="searchResultSnippet(result)" />
                </button>
              </section>
            </template>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="btn btn--ghost topbar__notification-button"
        aria-label="Open notifications"
        @click="openNotifications"
      >
        <span>Notifications</span>
        <span v-if="unreadNotificationCount > 0" class="topbar__notification-badge">
          {{ unreadNotificationCount > 99 ? '99+' : unreadNotificationCount }}
        </span>
      </button>
      <button type="button" class="topbar__user topbar__user-button" aria-label="Edit profile" @click="openProfileModal">
        {{ avatarInitial }}
      </button>
    </div>
  </header>

  <div v-if="showProfileModal" class="booking-drawer-overlay" @click="closeProfileModal" />
  <div v-if="showProfileModal" class="topbar-profile-modal">
    <h3>Profile settings</h3>

    <div class="topbar-profile-modal__section">
      <h4>Account</h4>
      <label class="field">
        <span class="field__label">Username</span>
        <input
          v-model="usernameDraft"
          type="text"
          class="input"
          maxlength="64"
          :disabled="isSavingProfile"
        />
      </label>
    </div>

    <div class="topbar-profile-modal__section">
      <h4>Notification preferences</h4>
      <label class="checkbox">
        <input
          type="checkbox"
          :checked="true"
          disabled
          title="In-app notifications are always enabled."
        />
        <span>In-app notifications (always on)</span>
      </label>
      <label class="checkbox">
        <input
          type="checkbox"
          :checked="notificationChannels.emailEnabled"
          disabled
          title="Offline mode only supports in-app notifications."
        />
        <span>Email (disabled offline)</span>
      </label>
      <label class="checkbox">
        <input
          type="checkbox"
          :checked="notificationChannels.smsEnabled"
          disabled
          title="Offline mode only supports in-app notifications."
        />
        <span>SMS (disabled offline)</span>
      </label>
      <label class="checkbox">
        <input
          type="checkbox"
          :checked="currentNotificationPreferences.booking"
          :disabled="profileSettingsStore.isSaving || isNotificationTypeDisabledByAdmin('booking')"
          :title="isNotificationTypeDisabledByAdmin('booking') ? 'Disabled by system' : ''"
          @change="toggleNotificationPreference('booking', ($event.target as HTMLInputElement).checked)"
        />
        <span>Booking updates</span>
      </label>
      <label class="checkbox">
        <input
          type="checkbox"
          :checked="currentNotificationPreferences.messages"
          :disabled="profileSettingsStore.isSaving || isNotificationTypeDisabledByAdmin('messages')"
          :title="isNotificationTypeDisabledByAdmin('messages') ? 'Disabled by system' : ''"
          @change="toggleNotificationPreference('messages', ($event.target as HTMLInputElement).checked)"
        />
        <span>Messages</span>
      </label>
      <label class="checkbox">
        <input
          type="checkbox"
          :checked="currentNotificationPreferences.community"
          :disabled="profileSettingsStore.isSaving || isNotificationTypeDisabledByAdmin('community')"
          :title="isNotificationTypeDisabledByAdmin('community') ? 'Disabled by system' : ''"
          @change="toggleNotificationPreference('community', ($event.target as HTMLInputElement).checked)"
        />
        <span>Community activity</span>
      </label>
    </div>

    <div class="topbar-profile-modal__section">
      <h4>Blocked users</h4>
      <div class="topbar-profile-modal__block-row">
        <input
          v-model="blockUsernameDraft"
          type="text"
          class="input"
          placeholder="Username"
          :disabled="profileSettingsStore.isSaving"
        />
        <button
          type="button"
          class="btn btn--outline"
          :disabled="profileSettingsStore.isSaving || !blockUsernameDraft.trim()"
          @click="blockByUsername"
        >
          Block user
        </button>
      </div>

      <div v-if="blockedUsers.length === 0" class="muted">No blocked users.</div>
      <ul v-else class="topbar-profile-modal__blocked-list">
        <li v-for="blockedUser in blockedUsers" :key="blockedUser.id">
          <span>{{ blockedUser.username }}</span>
          <button
            type="button"
            class="btn btn--ghost"
            :disabled="profileSettingsStore.isSaving"
            @click="unblockUser(blockedUser.id)"
          >
            Unblock
          </button>
        </li>
      </ul>
    </div>

    <p v-if="profileError" class="form-error">{{ profileError }}</p>
    <p v-else-if="profileSettingsStore.errorMessage" class="form-error">{{ profileSettingsStore.errorMessage }}</p>
    <p v-else-if="profileSettingsStore.successMessage" class="admin-success">
      {{ profileSettingsStore.successMessage }}
    </p>
    <div class="topbar-profile-modal__actions">
      <button type="button" class="btn btn--outline" :disabled="isSavingProfile" @click="closeProfileModal">
        Cancel
      </button>
      <button type="button" class="btn btn--primary" :disabled="isSavingProfile" @click="saveProfile">
        Save
      </button>
    </div>
  </div>
</template>
