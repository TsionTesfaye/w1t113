import { createAuthRepository } from '@/repositories/AuthRepository';
import { createBookingRepository } from '@/repositories/BookingRepository';
import { createCommunityRepository } from '@/repositories/CommunityRepository';
import { createSearchRepository } from '@/repositories/SearchRepository';
import { createSearchService, type SearchService } from '@/services/SearchService';

const searchRepository = createSearchRepository();
const bookingRepository = createBookingRepository();
const authRepository = createAuthRepository();
const communityRepository = createCommunityRepository();

const searchService = createSearchService(
  searchRepository,
  bookingRepository,
  authRepository,
  communityRepository
);

export function getSearchService(): SearchService {
  return searchService;
}
