import 'vue-router';
import type { UserRole } from '@/app/types/domain';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    requiresAuth?: boolean;
    publicOnly?: boolean;
    requiredRole?: UserRole | UserRole[];
  }
}
