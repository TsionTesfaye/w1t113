<script setup lang="ts">
import { useMessageStore } from '@/modules/messaging/stores/useMessageStore';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const messageStore = useMessageStore();

const threads = computed(() => messageStore.threads);

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function resolveServiceName(serviceId: string): string {
  return messageStore.serviceNameById[serviceId] ?? serviceId;
}

function previewContent(value: string | undefined): string {
  if (!value) {
    return 'No messages yet.';
  }

  return value.length > 90 ? `${value.slice(0, 90)}...` : value;
}

function openThread(threadId: string): void {
  void router.push(`/messages/${threadId}`);
}

onMounted(async () => {
  await messageStore.initialize();
});
</script>

<template>
  <section class="page-stack">
    <div class="page-header">
      <div>
        <h2>Messages</h2>
      </div>
    </div>

    <div class="booking-inline-summary">
      {{ threads.length }} threads · {{ messageStore.unreadCount }} unread
    </div>

    <p v-if="messageStore.errorMessage" class="form-error">{{ messageStore.errorMessage }}</p>

    <div v-if="messageStore.isLoadingThreads" class="slot-empty-state">
      <p class="slot-empty-state__title">Loading conversations</p>
      <p class="slot-empty-state__subtitle">Please wait while local messages are loaded.</p>
    </div>

    <div v-else-if="threads.length === 0" class="slot-empty-state">
      <p class="slot-empty-state__title">No booking conversations yet</p>
      <p class="slot-empty-state__subtitle">A thread is created automatically when a booking is confirmed.</p>
    </div>

    <div v-else class="message-thread-list">
      <button
        v-for="thread in threads"
        :key="thread.thread.id"
        type="button"
        class="message-thread-item"
        @click="openThread(thread.thread.id)"
      >
        <div class="message-thread-item__head">
          <p class="message-thread-item__title">
            {{ resolveServiceName(thread.booking.serviceId) }}
          </p>
          <div class="message-thread-item__head-right">
            <span class="message-thread-item__time">
              {{ formatDateTime(thread.lastMessage?.createdAt ?? thread.thread.createdAt) }}
            </span>
            <span v-if="thread.unreadCount > 0" class="thread-unread-badge">{{ thread.unreadCount }}</span>
          </div>
        </div>
        <p class="message-thread-item__preview">{{ previewContent(thread.lastMessage?.content) }}</p>
      </button>
    </div>
  </section>
</template>
