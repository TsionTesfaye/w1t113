import { createAuthRepository } from '@/repositories/AuthRepository';
import { createBookingRepository } from '@/repositories/BookingRepository';
import { getMessageService } from '@/app/providers/messagingProvider';
import { getNotificationService } from '@/app/providers/notificationProvider';
import { getOutboxService } from '@/app/providers/outboxProvider';
import { getSearchService } from '@/app/providers/searchProvider';
import { createBookingService, type BookingService } from '@/services/BookingService';

const bookingRepository = createBookingRepository();
const authRepository = createAuthRepository();
const messageService = getMessageService();
const notificationService = getNotificationService();
const outboxService = getOutboxService();
const searchService = getSearchService();
const bookingService = createBookingService(
  bookingRepository,
  authRepository,
  messageService,
  notificationService,
  outboxService,
  searchService
);

export function getBookingService(): BookingService {
  return bookingService;
}
