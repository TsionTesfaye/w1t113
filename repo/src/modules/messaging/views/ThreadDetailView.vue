<script setup lang="ts">
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { Message } from '@/app/types/domain';
import BookingStatusStepper from '@/modules/messaging/components/BookingStatusStepper.vue';
import { useMessageStore } from '@/modules/messaging/stores/useMessageStore';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();
const messageStore = useMessageStore();
const draftMessages = ref<Record<string, string>>({});
const messagesScrollRef = ref<HTMLElement | null>(null);
const composerTextareaRef = ref<HTMLTextAreaElement | null>(null);

const threadId = computed(() => String(route.params.threadId ?? ''));
const currentUserId = computed(() => authStore.currentUser?.id ?? '');

const activeThread = computed(() => messageStore.activeThread);
const activeMessages = computed(() => messageStore.activeMessages);
const threads = computed(() => messageStore.threads);
const activeThreadSummary = computed(() =>
  threads.value.find((item) => item.thread.id === activeThread.value?.id)
);
const isThreadReadOnly = computed(() => messageStore.isActiveThreadReadOnly);
const threadReadOnlyMessage = computed(() => messageStore.activeThreadReadOnlyMessage);
const currentDraft = computed({
  get: () => draftMessages.value[threadId.value] ?? '',
  set: (value: string) => {
    if (!threadId.value) {
      return;
    }

    draftMessages.value = {
      ...draftMessages.value,
      [threadId.value]: value
    };
  }
});

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], {
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

  return value.length > 48 ? `${value.slice(0, 48)}...` : value;
}

function isMessageMine(senderId: string): boolean {
  return senderId === currentUserId.value;
}

function senderLabel(message: Message): string {
  if (isMessageMine(message.senderId)) {
    return 'You';
  }

  if (message.senderRole === 'admin') {
    return 'Studio';
  }

  if (message.senderRole === 'photographer') {
    return 'Photographer';
  }

  return message.senderDisplayName || 'Client';
}

async function loadThreadOrRedirect(): Promise<void> {
  if (!threadId.value) {
    await router.replace('/messages');
    return;
  }

  try {
    await messageStore.initialize();
    await messageStore.loadThread(threadId.value);
  } catch {
    await router.replace('/messages');
  }
}

function openThread(targetThreadId: string): void {
  void router.push(`/messages/${targetThreadId}`);
}

async function sendMessage(): Promise<void> {
  if (isThreadReadOnly.value) {
    return;
  }

  const content = currentDraft.value;
  if (!content.trim() || messageStore.isSubmitting) {
    return;
  }

  await messageStore.sendMessage(content);
  currentDraft.value = '';
  await nextTick();
  resizeComposer();
}

function scrollToLatest(): void {
  if (!messagesScrollRef.value) {
    return;
  }

  messagesScrollRef.value.scrollTop = messagesScrollRef.value.scrollHeight;
}

function resizeComposer(): void {
  const textarea = composerTextareaRef.value;
  if (!textarea) {
    return;
  }

  textarea.style.height = 'auto';
  const nextHeight = Math.max(44, Math.min(textarea.scrollHeight, 140));
  textarea.style.height = `${nextHeight}px`;
}

onMounted(async () => {
  await loadThreadOrRedirect();
  await nextTick();
  resizeComposer();
  scrollToLatest();
});

watch(
  () => threadId.value,
  async () => {
    await loadThreadOrRedirect();
    await nextTick();
    resizeComposer();
    scrollToLatest();
  }
);

watch(
  () => activeMessages.value.length,
  async () => {
    await nextTick();
    scrollToLatest();
  }
);

watch(
  () => currentDraft.value,
  async () => {
    await nextTick();
    resizeComposer();
  }
);

watch(
  () => (authStore.currentUser?.blockedUserIds ?? []).join(','),
  async () => {
    if (!activeThread.value) {
      return;
    }

    try {
      await messageStore.loadThread(activeThread.value.id, { silent: true });
    } catch {
      // Keep the current view stable if participant access changed.
    }
  }
);
</script>

<template>
  <section class="page-stack">
    <p v-if="messageStore.errorMessage" class="form-error">{{ messageStore.errorMessage }}</p>

    <div class="thread-layout">
      <aside class="thread-layout__list">
        <div class="thread-mini-list">
          <button
            v-for="thread in threads"
            :key="thread.thread.id"
            type="button"
            class="thread-mini-list__item"
            :class="{ 'is-active': thread.thread.id === threadId }"
            @click="openThread(thread.thread.id)"
          >
            <div class="thread-mini-list__head">
              <p class="thread-mini-list__title">{{ resolveServiceName(thread.booking.serviceId) }}</p>
              <span class="thread-mini-list__time">
                {{ formatTime(thread.lastMessage?.createdAt ?? thread.thread.createdAt) }}
              </span>
            </div>
            <p class="thread-mini-list__preview">{{ previewContent(thread.lastMessage?.content) }}</p>
            <span v-if="thread.unreadCount > 0" class="thread-unread-badge">{{ thread.unreadCount }}</span>
          </button>
        </div>
      </aside>

      <div class="thread-layout__detail">
        <div v-if="messageStore.isLoadingThread" class="slot-empty-state">
          <p class="slot-empty-state__title">Opening conversation</p>
          <p class="slot-empty-state__subtitle">Loading message history from local storage.</p>
        </div>

        <template v-else-if="activeThread">
          <div class="thread-detail__header">
            <div>
              <p class="thread-detail__title">
                {{ resolveServiceName(activeThreadSummary?.booking.serviceId ?? '') }}
              </p>
              <p v-if="activeThreadSummary" class="thread-detail__meta">
                {{ formatDateTime(activeThreadSummary.booking.startTime) }}
              </p>
            </div>
            <button type="button" class="btn btn--ghost" @click="router.push('/messages')">
              Back
            </button>
          </div>
          <BookingStatusStepper
            v-if="activeThreadSummary"
            :booking="activeThreadSummary.booking"
          />

          <div ref="messagesScrollRef" class="thread-messages">
            <div
              v-for="message in activeMessages"
              :key="message.id"
              class="message-bubble"
              :class="{ 'is-mine': isMessageMine(message.senderId) }"
            >
              <p class="message-bubble__content">{{ message.content }}</p>
              <p class="message-bubble__meta">
                {{ senderLabel(message) }} · {{ formatTime(message.createdAt) }}
              </p>
            </div>
            <div v-if="activeMessages.length === 0" class="slot-empty-state">
              <p class="slot-empty-state__title">No messages yet</p>
              <p class="slot-empty-state__subtitle">Start the conversation for this booking.</p>
            </div>
          </div>

          <form class="thread-composer" @submit.prevent="sendMessage">
            <p v-if="isThreadReadOnly" class="thread-read-only-note">
              {{ threadReadOnlyMessage }}
            </p>
            <label class="field thread-composer__field">
              <textarea
                ref="composerTextareaRef"
                v-model="currentDraft"
                class="input thread-composer__input"
                rows="1"
                maxlength="1000"
                placeholder="Message"
                :disabled="isThreadReadOnly"
                @input="resizeComposer"
              />
            </label>
            <button
              type="submit"
              class="btn btn--primary"
              :disabled="messageStore.isSubmitting || !currentDraft.trim() || isThreadReadOnly"
            >
              Send
            </button>
          </form>
        </template>
      </div>
    </div>
  </section>
</template>
