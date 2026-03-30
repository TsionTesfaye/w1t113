import { createAuthRepository } from '@/repositories/AuthRepository';
import { createCommunityRepository } from '@/repositories/CommunityRepository';
import { getNotificationService } from '@/app/providers/notificationProvider';
import { getSearchService } from '@/app/providers/searchProvider';
import { createCommunityService, type CommunityService } from '@/services/CommunityService';

const communityRepository = createCommunityRepository();
const authRepository = createAuthRepository();
const notificationService = getNotificationService();
const searchService = getSearchService();
const communityService = createCommunityService(
  communityRepository,
  authRepository,
  notificationService,
  searchService
);

export function getCommunityService(): CommunityService {
  return communityService;
}
