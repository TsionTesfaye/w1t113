import { createImportExportRepository } from '@/repositories/ImportExportRepository';
import { createAuthRepository } from '@/repositories/AuthRepository';
import { createImportExportService, type ImportExportService } from '@/services/ImportExportService';

const importExportRepository = createImportExportRepository();
const authRepository = createAuthRepository();
const importExportService = createImportExportService(importExportRepository, authRepository);

export function getImportExportService(): ImportExportService {
  return importExportService;
}
