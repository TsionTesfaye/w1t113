import { getBookingService } from '@/app/providers/bookingProvider';
import { getMessageService } from '@/app/providers/messagingProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { Message, ServiceItem, Thread } from '@/app/types/domain';
import type { ThreadAccessState, ThreadSummary } from '@/services/MessagingService';
import { subscribeMessageChanged } from '@/services/messageEvents';
import { defineStore } from 'pinia';

interface MessageState {
  threads: ThreadSummary[];
  activeThread: Thread | null;
  activeThreadAccess: ThreadAccessState | null;
  activeMessages: Message[];
  serviceNameById: Record<string, string>;
  isLoadingThreads: boolean;
  isLoadingThread: boolean;
  isSubmitting: boolean;
  errorMessage: string;
}

interface LoadThreadOptions {
  silent?: boolean;
}

let unsubscribeFromMessageEvents: (() => void) | null = null;

function buildServiceNameMap(services: ServiceItem[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const service of services) {
    map[service.id] = service.name;
  }

  return map;
}

export const useMessageStore = defineStore('messages', {
  state: (): MessageState => ({
    threads: [],
    activeThread: null,
    activeThreadAccess: null,
    activeMessages: [],
    serviceNameById: {},
    isLoadingThreads: false,
    isLoadingThread: false,
    isSubmitting: false,
    errorMessage: ''
  }),

  getters: {
    unreadCount(state): number {
      return state.threads.reduce((count, thread) => count + thread.unreadCount, 0);
    },

    hasUnread(): boolean {
      return this.unreadCount > 0;
    },

    isActiveThreadReadOnly(state): boolean {
      return state.activeThreadAccess?.readOnly === true;
    },

    activeThreadReadOnlyMessage(state): string {
      return state.activeThreadAccess?.message ?? 'Messaging is unavailable for this conversation.';
    }
  },

  actions: {
    resolveCurrentUserId(): string | null {
      const authStore = useAuthStore();
      return authStore.currentUser?.id ?? null;
    },

    clearState(): void {
      this.threads = [];
      this.activeThread = null;
      this.activeThreadAccess = null;
      this.activeMessages = [];
      this.errorMessage = '';
      this.serviceNameById = {};
    },

    startListening(): void {
      if (unsubscribeFromMessageEvents) {
        return;
      }

      unsubscribeFromMessageEvents = subscribeMessageChanged((detail) => {
        const userId = this.resolveCurrentUserId();
        if (!userId || detail.userId !== userId) {
          return;
        }

        void this.refreshAfterMessageEvent();
      });
    },

    stopListening(): void {
      if (!unsubscribeFromMessageEvents) {
        return;
      }

      unsubscribeFromMessageEvents();
      unsubscribeFromMessageEvents = null;
    },

    async initialize(force = false): Promise<void> {
      const userId = this.resolveCurrentUserId();
      if (!userId) {
        this.stopListening();
        this.clearState();
        return;
      }

      this.startListening();

      if (!force && this.threads.length > 0) {
        return;
      }

      await this.fetchThreads();
    },

    async fetchThreads(): Promise<void> {
      const userId = this.resolveCurrentUserId();
      if (!userId) {
        this.clearState();
        return;
      }

      this.isLoadingThreads = true;
      this.errorMessage = '';

      try {
        const [threads, services] = await Promise.all([
          getMessageService().getUserThreads(userId),
          getBookingService().getServices()
        ]);

        this.threads = threads;
        this.serviceNameById = buildServiceNameMap(services);
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to load conversations.';
      } finally {
        this.isLoadingThreads = false;
      }
    },

    async loadThread(threadId: string, options: LoadThreadOptions = {}): Promise<void> {
      const userId = this.resolveCurrentUserId();
      if (!userId) {
        this.clearState();
        return;
      }

      if (!options.silent) {
        this.isLoadingThread = true;
      }
      this.errorMessage = '';

      try {
        const [thread, messages, access] = await Promise.all([
          getMessageService().getThreadById(threadId, userId),
          getMessageService().getThreadMessages(threadId, userId),
          getMessageService().getThreadAccessState(threadId, userId)
        ]);
        this.activeThread = thread;
        this.activeThreadAccess = access;
        this.activeMessages = messages;

        await this.fetchThreads();
      } catch (error: unknown) {
        this.activeThread = null;
        this.activeThreadAccess = null;
        this.activeMessages = [];
        this.errorMessage = error instanceof Error ? error.message : 'Unable to open conversation.';
        throw error;
      } finally {
        if (!options.silent) {
          this.isLoadingThread = false;
        }
      }
    },

    async sendMessage(content: string): Promise<void> {
      const userId = this.resolveCurrentUserId();
      if (!userId || !this.activeThread) {
        return;
      }

      if (this.activeThreadAccess?.readOnly) {
        this.errorMessage =
          this.activeThreadAccess.message ?? 'Messaging is unavailable for this conversation.';
        return;
      }

      this.isSubmitting = true;
      this.errorMessage = '';

      try {
        await getMessageService().sendMessage(this.activeThread.id, userId, content);
        const messages = await getMessageService().getThreadMessages(this.activeThread.id, userId);
        this.activeMessages = messages;
        await this.fetchThreads();
      } catch (error: unknown) {
        this.errorMessage = error instanceof Error ? error.message : 'Unable to send message.';
        throw error;
      } finally {
        this.isSubmitting = false;
      }
    },

    async openOrCreateThreadForBooking(bookingId: string): Promise<string> {
      this.errorMessage = '';
      const thread = await getMessageService().getOrCreateThread(bookingId);
      await this.fetchThreads();
      return thread.id;
    },

    async markActiveThreadAsRead(): Promise<void> {
      const userId = this.resolveCurrentUserId();
      if (!userId || !this.activeThread) {
        return;
      }

      await getMessageService().markThreadAsRead(this.activeThread.id, userId);
      await this.fetchThreads();
    },

    async refreshAfterMessageEvent(): Promise<void> {
      await this.fetchThreads();

      if (this.activeThread) {
        try {
          await this.loadThread(this.activeThread.id, { silent: true });
        } catch {
          // Keep current screen responsive if active thread was deleted or became inaccessible.
        }
      }
    }
  }
});
