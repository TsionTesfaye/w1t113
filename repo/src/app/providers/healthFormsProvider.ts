import { getAuthService } from '@/app/providers/authProvider';
import { getNotificationService } from '@/app/providers/notificationProvider';
import { createAuthRepository } from '@/repositories/AuthRepository';
import { createBookingRepository } from '@/repositories/BookingRepository';
import { createHealthFormRepository } from '@/repositories/HealthFormRepository';
import { createHealthFormService, type HealthFormService } from '@/services/HealthFormService';

const formsRepository = createHealthFormRepository();
const authRepository = createAuthRepository();
const bookingRepository = createBookingRepository();
const notificationService = getNotificationService();
const authService = getAuthService();

const healthFormService = createHealthFormService(
  formsRepository,
  authRepository,
  bookingRepository,
  notificationService,
  authService
);

export function getHealthFormService(): HealthFormService {
  return healthFormService;
}
