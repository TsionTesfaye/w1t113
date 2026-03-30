import {
  DB_NAME,
  DB_VERSION,
  STORE_DEFINITIONS,
  STORE_NAMES,
  type StoreName
} from '@/db/schema';

export type TransactionMode = 'readonly' | 'readwrite';

export interface TransactionContext {
  get<T>(storeName: StoreName, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(storeName: StoreName): Promise<T[]>;
  getByIndex<T>(storeName: StoreName, indexName: string, key: IDBValidKey): Promise<T | undefined>;
  getAllByIndex<T>(storeName: StoreName, indexName: string, key: IDBValidKey): Promise<T[]>;
  put<T>(storeName: StoreName, value: T, key?: IDBValidKey): Promise<void>;
  delete(storeName: StoreName, key: IDBValidKey): Promise<void>;
  clear(storeName: StoreName): Promise<void>;
}

export interface IndexedDbClient {
  withTransaction<T>(
    storeNames: StoreName[],
    mode: TransactionMode,
    execute: (transaction: TransactionContext) => Promise<T>
  ): Promise<T>;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionToError(transaction: IDBTransaction): Error {
  return transaction.error ?? new Error('IndexedDB transaction failed.');
}

function ensureStoreSchema(database: IDBDatabase, upgradeTransaction: IDBTransaction): void {
  for (const storeName of STORE_NAMES) {
    const definition = STORE_DEFINITIONS[storeName];

    if (!database.objectStoreNames.contains(storeName)) {
      const store = database.createObjectStore(storeName, {
        keyPath: definition.keyPath,
        autoIncrement: definition.autoIncrement
      });

      for (const index of definition.indexes ?? []) {
        store.createIndex(index.name, index.keyPath, { unique: index.unique });
      }

      continue;
    }

    const store = upgradeTransaction.objectStore(storeName);

    for (const index of definition.indexes ?? []) {
      if (!store.indexNames.contains(index.name)) {
        store.createIndex(index.name, index.keyPath, { unique: index.unique });
      }
    }
  }
}

class BrowserIndexedDbClient implements IndexedDbClient {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private getDatabase(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const openRequest = indexedDB.open(DB_NAME, DB_VERSION);

        openRequest.onupgradeneeded = () => {
          const database = openRequest.result;
          const upgradeTransaction = openRequest.transaction;
          if (!upgradeTransaction) {
            reject(new Error('IndexedDB upgrade transaction is unavailable.'));
            return;
          }

          ensureStoreSchema(database, upgradeTransaction);
        };

        openRequest.onsuccess = () => {
          const database = openRequest.result;

          database.onversionchange = () => {
            database.close();
            this.databasePromise = null;
          };

          resolve(database);
        };

        openRequest.onerror = () => {
          reject(openRequest.error ?? new Error('Failed to open IndexedDB database.'));
        };
      });
    }

    return this.databasePromise;
  }

  async withTransaction<T>(
    storeNames: StoreName[],
    mode: TransactionMode,
    execute: (transaction: TransactionContext) => Promise<T>
  ): Promise<T> {
    const database = await this.getDatabase();

    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeNames, mode);
      let didResolve = false;
      let didExecute = false;
      let executeResult: T;

      const rejectOnce = (error: Error): void => {
        if (didResolve) {
          return;
        }

        didResolve = true;
        reject(error);
      };

      const resolveIfReady = (): void => {
        if (!didResolve && didExecute) {
          didResolve = true;
          resolve(executeResult);
        }
      };

      transaction.oncomplete = () => {
        resolveIfReady();
      };

      transaction.onerror = () => {
        rejectOnce(transactionToError(transaction));
      };

      transaction.onabort = () => {
        rejectOnce(transactionToError(transaction));
      };

      const context: TransactionContext = {
        get: async <TValue>(storeName: StoreName, key: IDBValidKey): Promise<TValue | undefined> => {
          const request = transaction.objectStore(storeName).get(key);
          const result = await requestToPromise<TValue | undefined>(request);
          return result;
        },
        getAll: async <TValue>(storeName: StoreName): Promise<TValue[]> => {
          const request = transaction.objectStore(storeName).getAll();
          const result = await requestToPromise<TValue[]>(request);
          return result;
        },
        getByIndex: async <TValue>(
          storeName: StoreName,
          indexName: string,
          key: IDBValidKey
        ): Promise<TValue | undefined> => {
          const request = transaction.objectStore(storeName).index(indexName).get(key);
          const result = await requestToPromise<TValue | undefined>(request);
          return result;
        },
        getAllByIndex: async <TValue>(
          storeName: StoreName,
          indexName: string,
          key: IDBValidKey
        ): Promise<TValue[]> => {
          const request = transaction.objectStore(storeName).index(indexName).getAll(key);
          const result = await requestToPromise<TValue[]>(request);
          return result;
        },
        put: async <TValue>(storeName: StoreName, value: TValue, key?: IDBValidKey): Promise<void> => {
          const store = transaction.objectStore(storeName);
          const request = key === undefined ? store.put(value) : store.put(value, key);
          await requestToPromise(request);
        },
        delete: async (storeName: StoreName, key: IDBValidKey): Promise<void> => {
          const request = transaction.objectStore(storeName).delete(key);
          await requestToPromise(request);
        },
        clear: async (storeName: StoreName): Promise<void> => {
          const request = transaction.objectStore(storeName).clear();
          await requestToPromise(request);
        }
      };

      Promise.resolve(execute(context))
        .then((result) => {
          executeResult = result;
          didExecute = true;
          resolveIfReady();
        })
        .catch((error: unknown) => {
          try {
            transaction.abort();
          } catch {
            // Transaction may already be completed.
          }

          rejectOnce(error instanceof Error ? error : new Error('IndexedDB transaction execution failed.'));
        });
    });
  }
}

export const indexedDbClient: IndexedDbClient = new BrowserIndexedDbClient();
