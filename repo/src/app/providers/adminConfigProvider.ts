import { createAdminConfigRepository } from '@/repositories/AdminConfigRepository';
import { createAuthRepository } from '@/repositories/AuthRepository';
import { createAdminConfigService, type AdminConfigService } from '@/services/AdminConfigService';

const adminConfigRepository = createAdminConfigRepository();
const authRepository = createAuthRepository();
const adminConfigService = createAdminConfigService(adminConfigRepository, authRepository);

export function getAdminConfigService(): AdminConfigService {
  return adminConfigService;
}
