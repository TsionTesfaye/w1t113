<script setup lang="ts">
import { useAuthStore } from '@/app/stores/useAuthStore';
import { useMessageStore } from '@/modules/messaging/stores/useMessageStore';
import { computed, onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const props = defineProps<{
  collapsed: boolean;
  compact: boolean;
}>();

const emit = defineEmits<{
  navigate: [];
}>();

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const messageStore = useMessageStore();
const navItems = computed(() => {
  const role = authStore.currentUser?.role;

  if (role === 'client') {
    return [
      { to: '/booking', title: 'Book Session', glyph: 'BS', badgeCount: 0 },
      { to: '/my-bookings', title: 'My Bookings', glyph: 'MB', badgeCount: 0 },
      { to: '/forms', title: 'Forms', glyph: 'FM', badgeCount: 0 },
      { to: '/messages', title: 'Messages', glyph: 'MS', badgeCount: messageStore.unreadCount },
      { to: '/community', title: 'Community', glyph: 'CM', badgeCount: 0 }
    ] as const;
  }

  if (role === 'admin') {
    return [
      { to: '/admin/dashboard', title: 'Dashboard', glyph: 'DB', badgeCount: 0 },
      { to: '/admin/bookings', title: 'Bookings', glyph: 'BK', badgeCount: 0 },
      { to: '/admin/users', title: 'Users', glyph: 'US', badgeCount: 0 },
      { to: '/admin/forms', title: 'Forms', glyph: 'FR', badgeCount: 0 },
      { to: '/forms/responses', title: 'Responses', glyph: 'RS', badgeCount: 0 },
      { to: '/messages', title: 'Messages', glyph: 'MS', badgeCount: messageStore.unreadCount },
      { to: '/admin/data', title: 'Data', glyph: 'DT', badgeCount: 0 },
      { to: '/community', title: 'Community', glyph: 'CM', badgeCount: 0 }
    ] as const;
  }

  if (role === 'photographer') {
    return [
      { to: '/photographer/schedule', title: 'My Schedule', glyph: 'SC', badgeCount: 0 },
      { to: '/forms/responses', title: 'Responses', glyph: 'RS', badgeCount: 0 },
      { to: '/messages', title: 'Messages', glyph: 'MS', badgeCount: messageStore.unreadCount },
      { to: '/community', title: 'Community', glyph: 'CM', badgeCount: 0 }
    ] as const;
  }

  if (role === 'moderator') {
    return [
      { to: '/community', title: 'Community', glyph: 'CM', badgeCount: 0 },
      { to: '/messages', title: 'Messages', glyph: 'MS', badgeCount: messageStore.unreadCount }
    ] as const;
  }

  return [] as const;
});

const isCollapsedView = computed(() => props.collapsed && !props.compact);

watch(
  () => authStore.currentUser?.id,
  async (userId) => {
    if (!userId) {
      messageStore.stopListening();
      messageStore.clearState();
      return;
    }

    await messageStore.initialize(true);
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  messageStore.stopListening();
});

function onNavigate(): void {
  emit('navigate');
}

async function logout(): Promise<void> {
  await authStore.logout();
  messageStore.stopListening();
  messageStore.clearState();
  await router.push('/login');
  emit('navigate');
}

function isActive(path: string): boolean {
  if (path === '/forms/responses' && route.path.startsWith('/forms/')) {
    return true;
  }

  return route.path === path || route.path.startsWith(`${path}/`);
}
</script>

<template>
  <div class="sidebar" :class="{ 'is-collapsed': isCollapsedView }">
    <div class="sidebar__brand">
      <div class="sidebar__brand-mark">SO</div>
      <div v-if="!isCollapsedView" class="sidebar__brand-copy">
        <strong>StudioOps</strong>
      </div>
    </div>

    <nav class="sidebar__nav" aria-label="Primary">
      <section class="sidebar__section">
        <p v-if="!isCollapsedView" class="sidebar__section-title">Navigation</p>

        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="sidebar__link"
          :class="{ 'is-active': isActive(item.to) }"
          @click="onNavigate"
        >
          <span class="sidebar__glyph">{{ item.glyph }}</span>
          <span v-if="!isCollapsedView" class="sidebar__text sidebar__text--row">
            <span>
              <strong>{{ item.title }}</strong>
            </span>
            <span v-if="item.badgeCount > 0" class="sidebar__badge">
              {{ item.badgeCount }}
            </span>
          </span>
          <span v-else-if="item.badgeCount > 0" class="sidebar__dot" />
        </RouterLink>
      </section>
    </nav>

    <div class="sidebar__footer">
      <button type="button" class="btn btn--outline btn--block" @click="logout">
        <span v-if="isCollapsedView">Out</span>
        <span v-else>Log Out</span>
      </button>
    </div>
  </div>
</template>
