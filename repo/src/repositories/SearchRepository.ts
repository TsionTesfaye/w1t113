import type {
  SearchConfig,
  SearchEntityType,
  SearchIndexEntry,
  SearchTokenizerConfig
} from '@/app/types/domain';
import { indexedDbClient } from '@/db/indexedDbClient';

const SEARCH_CONFIG_ID = 'search-config';
const LEGACY_SYNONYMS_CONFIG_ID = 'search-synonyms';

export interface SearchRepository {
  upsertIndexEntry(entry: SearchIndexEntry): Promise<void>;
  removeIndexEntry(type: SearchEntityType, entityId: string): Promise<void>;
  listIndexEntries(type?: SearchEntityType): Promise<SearchIndexEntry[]>;
  resetIndex(entries: SearchIndexEntry[]): Promise<void>;
  getSearchConfig(): Promise<SearchConfig | null>;
  saveSearchConfig(config: SearchConfig): Promise<void>;
  getSynonyms(): Promise<Record<string, string[]> | null>;
  saveSynonyms(synonyms: Record<string, string[]>): Promise<void>;
}

function buildIndexId(type: SearchEntityType, entityId: string): string {
  return `${type}:${entityId}`;
}

function normalizeEntry(entry: SearchIndexEntry): SearchIndexEntry {
  return {
    id: entry.id,
    type: entry.type,
    title: entry.title,
    content: entry.content,
    tokens: Array.isArray(entry.tokens) ? [...new Set(entry.tokens)] : [],
    createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
    metadata: entry.metadata ?? {}
  };
}

function sortEntries(entries: SearchIndexEntry[]): SearchIndexEntry[] {
  return [...entries].sort((left, right) => right.createdAt - left.createdAt);
}

function defaultTokenizerConfig(): SearchTokenizerConfig {
  return {
    strategy: 'simple',
    minTokenLength: 1,
    stopwords: []
  };
}

function normalizeSynonyms(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string[]> = {};
  for (const [rawKey, rawValues] of Object.entries(value as Record<string, unknown>)) {
    const key = String(rawKey ?? '').trim().toLowerCase();
    if (!key) {
      continue;
    }

    if (!Array.isArray(rawValues)) {
      continue;
    }

    const values = rawValues
      .map((entry) => String(entry ?? '').trim().toLowerCase())
      .filter((entry) => entry.length > 0);
    normalized[key] = [...new Set(values)];
  }

  return normalized;
}

function normalizeTokenizerConfig(value: unknown): SearchTokenizerConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultTokenizerConfig();
  }

  const candidate = value as Partial<SearchTokenizerConfig>;
  const strategy: SearchTokenizerConfig['strategy'] =
    candidate.strategy === 'whitespace' ||
    candidate.strategy === 'simple' ||
    candidate.strategy === 'alphanumeric'
      ? candidate.strategy
      : 'simple';

  const minTokenLength =
    typeof candidate.minTokenLength === 'number' &&
    Number.isFinite(candidate.minTokenLength) &&
    candidate.minTokenLength >= 1
      ? Math.floor(candidate.minTokenLength)
      : 1;

  const stopwords = Array.isArray(candidate.stopwords)
    ? [...new Set(candidate.stopwords.map((entry) => String(entry ?? '').trim().toLowerCase()).filter(Boolean))]
    : [];

  return {
    strategy,
    minTokenLength,
    stopwords
  };
}

function normalizeSearchConfig(value: unknown): SearchConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<SearchConfig>;
  return {
    synonyms: normalizeSynonyms(candidate.synonyms),
    tokenizer: normalizeTokenizerConfig(candidate.tokenizer),
    updatedAt:
      typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : Date.now()
  };
}

class IndexedDbSearchRepository implements SearchRepository {
  async upsertIndexEntry(entry: SearchIndexEntry): Promise<void> {
    await indexedDbClient.withTransaction(['searchIndex'], 'readwrite', async (transaction) => {
      await transaction.put('searchIndex', normalizeEntry(entry));
    });
  }

  async removeIndexEntry(type: SearchEntityType, entityId: string): Promise<void> {
    await indexedDbClient.withTransaction(['searchIndex'], 'readwrite', async (transaction) => {
      await transaction.delete('searchIndex', buildIndexId(type, entityId));
    });
  }

  async listIndexEntries(type?: SearchEntityType): Promise<SearchIndexEntry[]> {
    return indexedDbClient.withTransaction(['searchIndex'], 'readonly', async (transaction) => {
      const records = type
        ? await transaction.getAllByIndex<SearchIndexEntry>('searchIndex', 'type', type)
        : await transaction.getAll<SearchIndexEntry>('searchIndex');

      return sortEntries(records.map((entry) => normalizeEntry(entry)));
    });
  }

  async resetIndex(entries: SearchIndexEntry[]): Promise<void> {
    await indexedDbClient.withTransaction(['searchIndex'], 'readwrite', async (transaction) => {
      const existing = await transaction.getAll<SearchIndexEntry>('searchIndex');
      for (const entry of existing) {
        await transaction.delete('searchIndex', entry.id);
      }

      for (const entry of entries) {
        await transaction.put('searchIndex', normalizeEntry(entry));
      }
    });
  }

  async getSearchConfig(): Promise<SearchConfig | null> {
    return indexedDbClient.withTransaction(['appConfig'], 'readonly', async (transaction) => {
      const configRecord = await transaction.get<{
        id: string;
        synonyms?: Record<string, string[]>;
        tokenizer?: SearchTokenizerConfig;
        updatedAt?: number;
      }>('appConfig', SEARCH_CONFIG_ID);
      const normalizedConfig = normalizeSearchConfig(configRecord);
      if (normalizedConfig) {
        return normalizedConfig;
      }

      const legacyRecord = await transaction.get<{ id: string; synonyms?: Record<string, string[]> }>(
        'appConfig',
        LEGACY_SYNONYMS_CONFIG_ID
      );
      if (!legacyRecord) {
        return null;
      }

      return {
        synonyms: normalizeSynonyms(legacyRecord.synonyms),
        tokenizer: defaultTokenizerConfig(),
        updatedAt: Date.now()
      };
    });
  }

  async saveSearchConfig(config: SearchConfig): Promise<void> {
    const normalized = normalizeSearchConfig(config);
    if (!normalized) {
      return;
    }

    await indexedDbClient.withTransaction(['appConfig'], 'readwrite', async (transaction) => {
      await transaction.put('appConfig', {
        id: SEARCH_CONFIG_ID,
        synonyms: normalized.synonyms,
        tokenizer: normalized.tokenizer,
        updatedAt: normalized.updatedAt
      });
    });
  }

  async getSynonyms(): Promise<Record<string, string[]> | null> {
    const config = await this.getSearchConfig();
    return config ? { ...config.synonyms } : null;
  }

  async saveSynonyms(synonyms: Record<string, string[]>): Promise<void> {
    const current = await this.getSearchConfig();
    await this.saveSearchConfig({
      synonyms: normalizeSynonyms(synonyms),
      tokenizer: current?.tokenizer ?? defaultTokenizerConfig(),
      updatedAt: Date.now()
    });
  }
}

export function createSearchRepository(): SearchRepository {
  return new IndexedDbSearchRepository();
}
