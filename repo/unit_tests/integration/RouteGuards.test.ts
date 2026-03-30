import { createAppRouter } from '@/app/router';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { User, UserRole } from '@/app/types/domain';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';

function createUser(role: UserRole): User {
  return {
    id: `${role}-1`,
    username: role,
    role,
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
  };
}

describe('Route guard integration', () => {
  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
  });

  it('allows /admin for admin users only', async () => {
    const authStore = useAuthStore();
    vi.spyOn(authStore, 'loadSession').mockResolvedValue(undefined);
    authStore.currentUser = createUser('admin');

    const router = createAppRouter(createMemoryHistory());
    await router.push('/admin');
    await router.isReady();

    expect(router.currentRoute.value.path).toBe('/admin');
  });

  it('redirects non-admin users away from /admin', async () => {
    const authStore = useAuthStore();
    vi.spyOn(authStore, 'loadSession').mockResolvedValue(undefined);
    authStore.currentUser = createUser('client');

    const router = createAppRouter(createMemoryHistory());
    await router.push('/admin');
    await router.isReady();

    expect(router.currentRoute.value.path).toBe('/booking');
  });

  it('allows /forms/responses for admin and photographer only', async () => {
    const authStore = useAuthStore();
    vi.spyOn(authStore, 'loadSession').mockResolvedValue(undefined);

    authStore.currentUser = createUser('admin');
    let router = createAppRouter(createMemoryHistory());
    await router.push('/forms/responses');
    await router.isReady();
    expect(router.currentRoute.value.path).toBe('/forms/responses');

    authStore.currentUser = createUser('photographer');
    router = createAppRouter(createMemoryHistory());
    await router.push('/forms/responses');
    await router.isReady();
    expect(router.currentRoute.value.path).toBe('/forms/responses');
  });

  it('denies /forms/responses for unauthorized roles', async () => {
    const authStore = useAuthStore();
    vi.spyOn(authStore, 'loadSession').mockResolvedValue(undefined);
    authStore.currentUser = createUser('client');

    const router = createAppRouter(createMemoryHistory());
    await router.push('/forms/responses');
    await router.isReady();

    expect(router.currentRoute.value.path).toBe('/booking');
  });

  it('redirects unauthenticated direct navigation to login', async () => {
    const authStore = useAuthStore();
    vi.spyOn(authStore, 'loadSession').mockResolvedValue(undefined);
    authStore.currentUser = null;

    const router = createAppRouter(createMemoryHistory());
    await router.push('/admin');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/admin');
  });
});
