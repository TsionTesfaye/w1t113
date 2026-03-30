import { getImportExportService } from '@/app/providers/importExportProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import { toUserErrorMessage } from '@/app/utils/errorMessage';
import { defineStore } from 'pinia';

interface ImportExportState {
  isLoading: boolean;
  errorMessage: string;
  successMessage: string;
}

function buildDownloadFilename(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `studioops-backup-${year}${month}${day}-${hours}${minutes}.json`;
}

export const useImportExportStore = defineStore('importExport', {
  state: (): ImportExportState => ({
    isLoading: false,
    errorMessage: '',
    successMessage: ''
  }),

  actions: {
    resolveActorId(): string {
      const userId = useAuthStore().currentUser?.id;
      if (!userId) {
        throw new Error('Authentication is required.');
      }

      return userId;
    },

    clearFeedback(): void {
      this.errorMessage = '';
      this.successMessage = '';
    },

    async exportBackup(): Promise<void> {
      this.isLoading = true;
      this.clearFeedback();

      try {
        const actorId = this.resolveActorId();
        const blob = await getImportExportService().exportBackup(actorId);
        const objectUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = buildDownloadFilename();
        anchor.click();
        window.URL.revokeObjectURL(objectUrl);
        this.successMessage = 'Backup exported successfully.';
      } catch (error: unknown) {
        this.errorMessage = toUserErrorMessage(error, 'Failed to export backup.');
      } finally {
        this.isLoading = false;
      }
    },

    async importBackupFile(file: File): Promise<void> {
      this.isLoading = true;
      this.clearFeedback();

      try {
        const actorId = this.resolveActorId();
        const rawJson = await file.text();
        const validation = await getImportExportService().validateImport(actorId, rawJson);
        if (!validation.valid) {
          throw new Error(validation.errors.join(' '));
        }

        await getImportExportService().importBackup(actorId, rawJson);
        this.successMessage = 'Backup imported successfully. Refreshing data...';
      } catch (error: unknown) {
        this.errorMessage = toUserErrorMessage(error, 'Failed to import backup.');
        throw error;
      } finally {
        this.isLoading = false;
      }
    }
  }
});
