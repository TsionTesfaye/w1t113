import { getOutboxService } from '@/app/providers/outboxProvider';
import { createAdminConfigRepository } from '@/repositories/AdminConfigRepository';
import { createAuthRepository } from '@/repositories/AuthRepository';
import { createNotificationRepository } from '@/repositories/NotificationRepository';
import { createNotificationService, type NotificationService } from '@/services/NotificationService';

const notificationRepository = createNotificationRepository();
const authRepository = createAuthRepository();
const adminConfigRepository = createAdminConfigRepository();
const outboxService = getOutboxService();
const notificationService = createNotificationService(
  notificationRepository,
  authRepository,
  adminConfigRepository,
  outboxService
);

export function getNotificationService(): NotificationService {
  return notificationService;
}
