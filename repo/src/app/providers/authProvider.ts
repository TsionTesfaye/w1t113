import { createAuthRepository } from '@/repositories/AuthRepository';
import { createAuthService, type AuthService } from '@/services/AuthService';
import { getBookingService } from '@/app/providers/bookingProvider';
import { getSearchService } from '@/app/providers/searchProvider';

const authRepository = createAuthRepository();
const searchService = getSearchService();
const bookingService = getBookingService();
const authService = createAuthService(authRepository, searchService, bookingService);

export function getAuthService(): AuthService {
  return authService;
}
