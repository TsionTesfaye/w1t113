import { useAuthStore } from '@/app/stores/useAuthStore';
import type { AuthenticatedSession } from '@/services/AuthService';
import { useBookingStore } from '@/modules/booking/stores/useBookingStore';
import { useMessageStore } from '@/modules/messaging/stores/useMessageStore';
import { useSearchStore } from '@/modules/search/stores/useSearchStore';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authServiceMock = {
  login: vi.fn(),
  logout: vi.fn(async () => {}),
  loadSession: vi.fn(async () => null),
  register: vi.fn(),
  updateUser: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  isInitialAdminSetupRequired: vi.fn(async () => false),
  bootstrapInitialAdmin: vi.fn(),
  getActiveEncryptionKey: vi.fn(() => null)
};

vi.mock('@/app/providers/authProvider', () => ({
  getAuthService: () => authServiceMock
}));

function createSession(): AuthenticatedSession {
  return {
    user: {
      id: 'client-1',
      username: 'client',
      role: 'client',
      isActive: true,
      notificationPreferences: {
        booking: true,
        messages: true,
        community: true
      },
      blockedUserIds: [],
      createdAt: Date.now(),
      failedAttempts: 0,
      lockUntil: null
    },
    session: {
      id: 'session-1',
      userId: 'client-1',
      token: 'token-1',
      createdAt: Date.now(),
      expiresAt: null,
      rememberMe: false
    },
    hasActiveEncryptionKey: false
  };
}

describe('Auth store isolation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    authServiceMock.login.mockReset();
    authServiceMock.logout.mockReset();
    authServiceMock.loadSession.mockReset();
    authServiceMock.logout.mockResolvedValue(undefined);
    authServiceMock.loadSession.mockResolvedValue(null);
    authServiceMock.login.mockResolvedValue(createSession());
  });

  it('clears user-scoped stores on logout', async () => {
    const authStore = useAuthStore();
    const bookingStore = useBookingStore();
    const messageStore = useMessageStore();
    const searchStore = useSearchStore();

    await authStore.login('client', 'password', false);

    bookingStore.selectedServiceId = 'service-1';
    bookingStore.errorMessage = 'temporary';
    messageStore.threads = [
      {
        thread: {
          id: 'thread-1',
          bookingId: 'booking-1',
          participants: ['client-1'],
          createdAt: Date.now()
        },
        booking: {
          id: 'booking-1',
          userId: 'client-1',
          photographerId: 'photographer-1',
          serviceId: 'service-1',
          slotId: 'slot-1',
          status: 'pending',
          startTime: Date.now() + 1_000,
          endTime: Date.now() + 1_800_000,
          dayKey: '2026-03-30',
          createdAt: Date.now()
        },
        lastMessage: null,
        unreadCount: 1
      }
    ];
    searchStore.query = 'client';
    searchStore.results = [
      {
        id: 'r1',
        type: 'booking',
        title: 'Booking',
        snippet: 'Booking result',
        score: 10,
        highlights: []
      }
    ];

    await authStore.logout();

    expect(authStore.currentUser).toBeNull();
    expect(bookingStore.selectedServiceId).toBeNull();
    expect(bookingStore.errorMessage).toBe('');
    expect(messageStore.threads).toEqual([]);
    expect(searchStore.query).toBe('');
    expect(searchStore.results).toEqual([]);
  });
});

