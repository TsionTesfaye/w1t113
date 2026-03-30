import { useAuthStore } from '@/app/stores/useAuthStore';
import type { UserRole } from '@/app/types/domain';
import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type Router,
  type RouterHistory
} from 'vue-router';

function getDefaultAuthenticatedRoute(role: UserRole | undefined): { name: string } {
  if (role === 'admin') {
    return { name: 'admin-dashboard' };
  }

  if (role === 'photographer') {
    return { name: 'photographer-schedule' };
  }

  if (role === 'moderator') {
    return { name: 'community' };
  }

  return { name: 'booking' };
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: () => import('@/app/layout/AuthLayout.vue'),
    children: [
      {
        path: '',
        name: 'login',
        component: () => import('@/modules/auth/views/LoginView.vue'),
        meta: { title: 'Sign In', publicOnly: true }
      }
    ]
  },
  {
    path: '/register',
    component: () => import('@/app/layout/AuthLayout.vue'),
    children: [
      {
        path: '',
        name: 'register',
        component: () => import('@/modules/auth/views/RegisterView.vue'),
        meta: { title: 'Register', publicOnly: true }
      }
    ]
  },
  {
    path: '/',
    component: () => import('@/app/layout/DashboardLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        redirect: { name: 'booking' }
      },
      {
        path: 'booking',
        name: 'booking',
        component: () => import('@/modules/booking/views/BookingView.vue'),
        meta: { title: 'Book Session', requiredRole: 'client' }
      },
      {
        path: 'my-bookings',
        name: 'my-bookings',
        component: () => import('@/modules/booking/views/MyBookingsView.vue'),
        meta: { title: 'My Bookings', requiredRole: 'client' }
      },
      {
        path: 'bookings/:id',
        name: 'booking-search-result',
        component: () => import('@/modules/search/views/BookingSearchResultRedirectView.vue'),
        meta: { title: 'Booking Result' }
      },
      {
        path: 'users/:id',
        name: 'user-search-result',
        component: () => import('@/modules/search/views/UserSearchResultRedirectView.vue'),
        meta: { title: 'User Result', requiredRole: 'admin' }
      },
      {
        path: 'messages',
        name: 'messages',
        component: () => import('@/modules/messaging/views/ThreadsView.vue'),
        meta: { title: 'Messages' }
      },
      {
        path: 'messages/:threadId',
        name: 'message-thread-detail',
        component: () => import('@/modules/messaging/views/ThreadDetailView.vue'),
        meta: { title: 'Conversation' }
      },
      {
        path: 'notifications',
        name: 'notifications',
        component: () => import('@/modules/notifications/views/NotificationCenter.vue'),
        meta: { title: 'Notifications' }
      },
      {
        path: 'photographer/schedule',
        name: 'photographer-schedule',
        component: () => import('@/modules/photographer/views/PhotographerDashboardView.vue'),
        meta: { title: 'My Schedule', requiredRole: 'photographer' }
      },
      {
        path: 'photographer/dashboard',
        redirect: { name: 'photographer-schedule' }
      },
      {
        path: 'photographer/availability',
        redirect: { name: 'photographer-schedule' }
      },
      {
        path: 'community',
        name: 'community',
        component: () => import('@/modules/community/views/CommunityView.vue'),
        meta: { title: 'Community' }
      },
      {
        path: 'community/moderation',
        name: 'community-moderation',
        redirect: {
          name: 'community',
          query: {
            filter: 'reported'
          }
        },
        meta: { title: 'Moderation', requiredRole: ['admin', 'moderator'] }
      },
      {
        path: 'forms',
        name: 'forms',
        component: () => import('@/modules/healthForms/views/FormsView.vue'),
        meta: { title: 'Forms', requiredRole: 'client' }
      },
      {
        path: 'forms/responses',
        name: 'forms-responses',
        component: () => import('@/modules/healthForms/views/FormResponsesView.vue'),
        meta: { title: 'Form Responses', requiredRole: ['admin', 'photographer'] }
      },
      {
        path: 'forms/:bookingId',
        name: 'form-detail',
        component: () => import('@/modules/healthForms/views/FormDetailView.vue'),
        meta: { title: 'Form Detail', requiredRole: 'client' }
      },
      {
        path: 'admin/dashboard',
        name: 'admin-dashboard',
        component: () => import('@/modules/admin/views/AdminDashboardView.vue'),
        meta: { title: 'Dashboard', requiredRole: 'admin' }
      },
      {
        path: 'admin',
        name: 'admin',
        component: () => import('@/modules/admin/views/AdminView.vue'),
        meta: { title: 'Admin', requiredRole: 'admin' }
      },
      {
        path: 'admin/users',
        name: 'admin-users',
        component: () => import('@/modules/admin/views/AdminUsersView.vue'),
        meta: { title: 'User Management', requiredRole: 'admin' }
      },
      {
        path: 'admin/bookings',
        name: 'admin-bookings',
        component: () => import('@/modules/admin/views/AdminBookingsView.vue'),
        meta: { title: 'Booking Control', requiredRole: 'admin' }
      },
      {
        path: 'admin/bookings/create',
        redirect: { name: 'admin-bookings' }
      },
      {
        path: 'admin/forms',
        name: 'admin-forms',
        component: () => import('@/modules/admin/views/AdminFormsView.vue'),
        meta: { title: 'Form Templates', requiredRole: 'admin' }
      },
      {
        path: 'admin/data',
        name: 'admin-data',
        component: () => import('@/modules/admin/views/AdminDataView.vue'),
        meta: { title: 'Data Backup', requiredRole: 'admin' }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
];

export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const router = createRouter({
    history,
    routes
  });

  router.beforeEach(async (to) => {
    const authStore = useAuthStore();
    await authStore.loadSession();
    const isPublicRoute = Boolean(to.meta.publicOnly);

    if (!isPublicRoute && !authStore.isAuthenticated) {
      return { name: 'login', query: { redirect: to.fullPath } };
    }

    if (isPublicRoute && authStore.isAuthenticated) {
      return getDefaultAuthenticatedRoute(authStore.currentUser?.role);
    }

    const requiredRole = to.meta.requiredRole;
    if (requiredRole && authStore.currentUser) {
      const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      if (!allowedRoles.includes(authStore.currentUser.role)) {
        const fallbackRoute = getDefaultAuthenticatedRoute(authStore.currentUser.role);
        if (to.name !== fallbackRoute.name) {
          return fallbackRoute;
        }
      }
    }

    return true;
  });

  return router;
}

function createDefaultHistory(): RouterHistory {
  if (typeof window === 'undefined') {
    return createMemoryHistory();
  }

  return createWebHistory();
}

export const router = createAppRouter(createDefaultHistory());
