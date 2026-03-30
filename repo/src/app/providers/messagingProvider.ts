import { createAuthRepository } from '@/repositories/AuthRepository';
import { createBookingRepository } from '@/repositories/BookingRepository';
import { createMessageRepository } from '@/repositories/MessagingRepository';
import { getNotificationService } from '@/app/providers/notificationProvider';
import { createMessageService, type MessageService } from '@/services/MessagingService';

const messageRepository = createMessageRepository();
const bookingRepository = createBookingRepository();
const authRepository = createAuthRepository();
const notificationService = getNotificationService();
const messageService = createMessageService(
  messageRepository,
  bookingRepository,
  authRepository,
  notificationService
);

export function getMessageService(): MessageService {
  return messageService;
}
