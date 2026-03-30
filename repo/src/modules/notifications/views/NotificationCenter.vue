<script setup lang="ts">
import { useNotificationStore } from '@/modules/notifications/stores/useNotificationStore';
import { computed, onMounted } from 'vue';

const notificationStore = useNotificationStore();

const notifications = computed(() => notificationStore.notifications);
const unreadCount = computed(() => notificationStore.unreadCount);

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function formatType(value: string): string {
  return value.replace(/\./g, ' ').replace(/\b\w/g, (part) => part.toUpperCase());
}

onMounted(async () => {
  await notificationStore.initialize();
});
</script>

<template>
  <section class="page-stack">
    <div class="page-header">
      <div>
        <h2>Notifications</h2>
      </div>

      <button
        type="button"
        class="btn btn--outline"
        :disabled="unreadCount === 0 || notificationStore.isSubmitting"
        @click="notificationStore.markAllAsRead"
      >
        Mark all as read
      </button>
    </div>

    <div class="booking-inline-summary">
      {{ unreadCount }} unread
    </div>

    <p v-if="notificationStore.errorMessage" class="form-error">{{ notificationStore.errorMessage }}</p>

    <div v-if="notificationStore.isLoading" class="slot-empty-state">
      <p class="slot-empty-state__title">Loading notifications</p>
      <p class="slot-empty-state__subtitle">Please wait while we sync your local timeline.</p>
    </div>

    <div v-else-if="notifications.length === 0" class="slot-empty-state">
      <p class="slot-empty-state__title">No notifications yet</p>
      <p class="slot-empty-state__subtitle">New booking and status updates will appear here.</p>
    </div>

    <ul v-else class="notification-list" aria-label="Notification timeline">
      <li
        v-for="notification in notifications"
        :key="notification.id"
        :class="['notification-item', { 'is-unread': !notification.read }]"
      >
        <div class="notification-item__body">
          <div class="notification-item__meta">
            <span :class="['pill', notification.read ? 'pill--role-client' : 'pill--success']">
              {{ formatType(notification.type) }}
            </span>
            <time :datetime="new Date(notification.createdAt).toISOString()" class="muted">
              {{ formatTimestamp(notification.createdAt) }}
            </time>
          </div>
          <p class="notification-item__message">{{ notification.message }}</p>
        </div>

        <button
          v-if="!notification.read"
          type="button"
          class="btn btn--ghost"
          :disabled="notificationStore.isSubmitting"
          @click="notificationStore.markAsRead(notification.id)"
        >
          Mark as read
        </button>
      </li>
    </ul>
  </section>
</template>
