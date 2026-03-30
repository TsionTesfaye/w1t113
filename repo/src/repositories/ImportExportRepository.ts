import { type StoreName, STORE_NAMES } from '@/db/schema';
import { indexedDbClient } from '@/db/indexedDbClient';

export interface ImportExportRepository {
  exportStores(): Promise<Record<StoreName, unknown[]>>;
  replaceStores(stores: Record<StoreName, unknown[]>): Promise<void>;
}

class IndexedDbImportExportRepository implements ImportExportRepository {
  async exportStores(): Promise<Record<StoreName, unknown[]>> {
    return indexedDbClient.withTransaction([...STORE_NAMES], 'readonly', async (transaction) => {
      const exported = {} as Record<StoreName, unknown[]>;

      for (const storeName of STORE_NAMES) {
        exported[storeName] = await transaction.getAll<unknown>(storeName);
      }

      return exported;
    });
  }

  async replaceStores(stores: Record<StoreName, unknown[]>): Promise<void> {
    await indexedDbClient.withTransaction([...STORE_NAMES], 'readwrite', async (transaction) => {
      for (const storeName of STORE_NAMES) {
        await transaction.clear(storeName);
      }

      for (const storeName of STORE_NAMES) {
        const records = stores[storeName] ?? [];
        for (const record of records) {
          await transaction.put(storeName, record);
        }
      }
    });
  }
}

export function createImportExportRepository(): ImportExportRepository {
  return new IndexedDbImportExportRepository();
}
