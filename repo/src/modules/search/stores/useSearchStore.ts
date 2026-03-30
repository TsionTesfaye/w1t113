import { getSearchService } from '@/app/providers/searchProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import { toUserErrorMessage } from '@/app/utils/errorMessage';
import type { SearchEntityType, SearchResult, SearchTokenizerConfig } from '@/app/types/domain';
import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';

interface SearchState {
  query: string;
  typeFilter: SearchEntityType | null;
  results: SearchResult[];
  synonyms: Record<string, string[]>;
  tokenizerConfig: SearchTokenizerConfig | null;
  matchedSynonym: string;
  isLoading: boolean;
  errorMessage: string;
}

function tokenizeSearchQuery(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function defaultTokenizerConfig(): SearchTokenizerConfig {
  return {
    strategy: 'simple',
    minTokenLength: 1,
    stopwords: []
  };
}

export const useSearchStore = defineStore('search', {
  state: (): SearchState => ({
    query: '',
    typeFilter: null,
    results: [],
    synonyms: {},
    tokenizerConfig: defaultTokenizerConfig(),
    matchedSynonym: '',
    isLoading: false,
    errorMessage: ''
  }),

  actions: {
    clear(): void {
      this.query = '';
      this.typeFilter = null;
      this.results = [];
      this.matchedSynonym = '';
      this.errorMessage = '';
    },

    async fetchSynonyms(): Promise<void> {
      await this.fetchSearchConfig();
    },

    async fetchSearchConfig(): Promise<void> {
      const actorId = useAuthStore().currentUser?.id;
      if (!actorId) {
        throw new Error('Authentication is required.');
      }

      this.isLoading = true;
      this.errorMessage = '';

      try {
        const config = await getSearchService().getSearchConfig(actorId);
        this.synonyms = config.synonyms;
        this.tokenizerConfig = config.tokenizer;
      } catch (error: unknown) {
        this.errorMessage = toUserErrorMessage(error, 'Unable to load search configuration.');
        throw error;
      } finally {
        this.isLoading = false;
      }
    },

    async saveSynonyms(synonyms: Record<string, string[]>): Promise<void> {
      await this.saveSearchConfig({ synonyms });
    },

    async saveSearchConfig(updates: {
      synonyms?: Record<string, string[]>;
      tokenizer?: Partial<SearchTokenizerConfig>;
    }): Promise<void> {
      const actorId = useAuthStore().currentUser?.id;
      if (!actorId) {
        throw new Error('Authentication is required.');
      }

      this.isLoading = true;
      this.errorMessage = '';

      try {
        const config = await getSearchService().updateSearchConfig(actorId, updates);
        this.synonyms = config.synonyms;
        this.tokenizerConfig = config.tokenizer;
      } catch (error: unknown) {
        this.errorMessage = toUserErrorMessage(error, 'Unable to save search configuration.');
        throw error;
      } finally {
        this.isLoading = false;
      }
    },

    async search(input: { query: string; type?: SearchEntityType }): Promise<void> {
      const { query, type } = input;
      const actorId = useAuthStore().currentUser?.id;
      if (!actorId) {
        throw new Error('Authentication is required.');
      }
      this.query = query;
      this.typeFilter = type ?? null;
      this.errorMessage = '';
      this.matchedSynonym = '';

      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        this.results = [];
        return;
      }

      this.isLoading = true;

      try {
        this.results = await getSearchService().search(actorId, normalizedQuery, type);

        const queryTokens = new Set(tokenizeSearchQuery(normalizedQuery));
        for (const result of this.results) {
          for (const token of result.highlights) {
            const normalizedToken = token.trim().toLowerCase();
            if (!normalizedToken || queryTokens.has(normalizedToken)) {
              continue;
            }

            this.matchedSynonym = normalizedToken;
            break;
          }

          if (this.matchedSynonym) {
            break;
          }
        }
      } catch (error: unknown) {
        this.results = [];
        this.errorMessage = toUserErrorMessage(error, 'Search failed.');
      } finally {
        this.isLoading = false;
      }
    },

    async performSearch(query: string, type?: SearchEntityType): Promise<void> {
      await this.search({ query, type });
    },

    async rebuildIndex(): Promise<void> {
      const actorId = useAuthStore().currentUser?.id;
      if (!actorId) {
        throw new Error('Authentication is required.');
      }

      this.isLoading = true;
      this.errorMessage = '';

      try {
        await getSearchService().rebuildIndex(actorId);
      } catch (error: unknown) {
        this.errorMessage = toUserErrorMessage(error, 'Unable to rebuild search index.');
      } finally {
        this.isLoading = false;
      }
    },

    async debugPrintIndex(type?: SearchEntityType): Promise<void> {
      if (!import.meta.env.DEV) {
        return;
      }

      const entries = await getSearchService().debugListIndexEntries(type);
      logger.info('SearchStore debug index entries', {
        context: 'SearchStore',
        type: type ?? 'all',
        count: entries.length,
        entries
      });
    }
  }
});
