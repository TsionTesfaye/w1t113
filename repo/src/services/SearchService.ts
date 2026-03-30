import type {
  Booking,
  CommunityPost,
  SearchConfig,
  SearchEntityType,
  SearchIndexEntry,
  SearchResult,
  SearchTokenizerConfig,
  SearchTokenizerStrategy,
  User
} from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { BookingRepository } from '@/repositories/BookingRepository';
import type { CommunityRepository } from '@/repositories/CommunityRepository';
import type { SearchRepository } from '@/repositories/SearchRepository';
import { nowMs } from '@/services/timeSource';
import { logger } from '@/utils/logger';

const EXCERPT_RADIUS = 72;
const ENABLE_SEARCH_DEBUG = import.meta.env.DEV;
const MIN_TOKEN_LENGTH_FLOOR = 1;
const DEFAULT_SYNONYMS: Record<string, string[]> = {
  booking: ['reservation', 'session'],
  client: ['customer']
};
const DEFAULT_TOKENIZER_CONFIG: SearchTokenizerConfig = {
  strategy: 'simple',
  minTokenLength: 1,
  stopwords: []
};

function buildEntryId(type: SearchEntityType, entityId: string): string {
  return `${type}:${entityId}`;
}

function parseEntityId(entryId: string): string {
  const separatorIndex = entryId.indexOf(':');
  if (separatorIndex === -1) {
    return entryId;
  }

  return entryId.slice(separatorIndex + 1);
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTokenizerStrategy(
  strategy: SearchTokenizerConfig['strategy'] | undefined
): SearchTokenizerStrategy {
  if (strategy === 'whitespace' || strategy === 'simple' || strategy === 'alphanumeric') {
    return strategy;
  }

  return DEFAULT_TOKENIZER_CONFIG.strategy;
}

function normalizeTokenizerConfig(
  value: Partial<SearchTokenizerConfig> | undefined
): SearchTokenizerConfig {
  const strategy = normalizeTokenizerStrategy(value?.strategy);
  const minTokenLength =
    typeof value?.minTokenLength === 'number' &&
    Number.isFinite(value.minTokenLength) &&
    value.minTokenLength >= MIN_TOKEN_LENGTH_FLOOR
      ? Math.floor(value.minTokenLength)
      : DEFAULT_TOKENIZER_CONFIG.minTokenLength;
  const stopwords = Array.isArray(value?.stopwords)
    ? [...new Set(value.stopwords.map((entry) => normalizeSearchText(String(entry ?? ''))).filter(Boolean))]
    : [];

  return {
    strategy,
    minTokenLength,
    stopwords
  };
}

function normalizeSynonyms(input: Record<string, string[]>): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};

  for (const [rawBase, rawValues] of Object.entries(input)) {
    const base = normalizeSearchText(rawBase);
    if (!base) {
      continue;
    }

    const values = Array.isArray(rawValues)
      ? rawValues
          .map((value) => normalizeSearchText(String(value ?? '')))
          .filter((value) => value.length > 0 && value !== base)
      : [];

    const deduped = [...new Set(values)];
    normalized[base] = deduped;
  }

  return normalized;
}

function buildSynonymGraph(synonyms: Record<string, string[]>): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  const ensureNode = (token: string): Set<string> => {
    let node = graph.get(token);
    if (!node) {
      node = new Set<string>([token]);
      graph.set(token, node);
    }
    return node;
  };

  for (const [base, values] of Object.entries(synonyms)) {
    const all = [base, ...values];
    for (const token of all) {
      const node = ensureNode(token);
      for (const related of all) {
        node.add(related);
      }
    }
  }

  return graph;
}

function expandTokensWithSynonyms(tokens: string[], graph: Map<string, Set<string>>): string[] {
  const expanded = new Set(tokens);

  for (const token of tokens) {
    const node = graph.get(token);
    if (!node) {
      continue;
    }

    for (const related of node) {
      expanded.add(related);
    }
  }

  return [...expanded];
}

export function tokenize(value: string): string[] {
  return tokenizeWithConfig(value, DEFAULT_TOKENIZER_CONFIG);
}

export function tokenizeWithConfig(value: string, config: SearchTokenizerConfig): string[] {
  const normalizedConfig = normalizeTokenizerConfig(config);
  if (!value.trim()) {
    return [];
  }

  let parts: string[] = [];
  if (normalizedConfig.strategy === 'whitespace') {
    parts = value
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
  } else if (normalizedConfig.strategy === 'alphanumeric') {
    parts = (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => token.length > 0);
  } else {
    const normalized = normalizeSearchText(value);
    if (!normalized) {
      return [];
    }
    parts = normalized.split(' ');
  }

  const deduped = new Set<string>();
  const stopwordSet = new Set(normalizedConfig.stopwords);

  for (const token of parts) {
    if (token.length < normalizedConfig.minTokenLength) {
      continue;
    }
    if (stopwordSet.has(token)) {
      continue;
    }

    deduped.add(token);
  }

  return [...deduped];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightText(value: string, matchedTokens: string[]): string {
  if (!value) {
    return '';
  }

  if (matchedTokens.length === 0) {
    return escapeHtml(value);
  }

  const escapedTokens = matchedTokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);

  if (escapedTokens.length === 0) {
    return escapeHtml(value);
  }

  const pattern = new RegExp(`(${escapedTokens.join('|')})`, 'gi');
  const escaped = escapeHtml(value);
  return escaped.replace(pattern, '<mark>$1</mark>');
}

function buildExcerpt(content: string, tokens: string[]): string {
  if (!content) {
    return '';
  }

  if (tokens.length === 0) {
    return content.slice(0, EXCERPT_RADIUS * 2);
  }

  const lowercaseContent = content.toLowerCase();
  let firstMatchIndex = -1;

  for (const token of tokens) {
    const index = lowercaseContent.indexOf(token.toLowerCase());
    if (index === -1) {
      continue;
    }

    if (firstMatchIndex === -1 || index < firstMatchIndex) {
      firstMatchIndex = index;
    }
  }

  if (firstMatchIndex === -1) {
    return content.slice(0, EXCERPT_RADIUS * 2);
  }

  const start = Math.max(0, firstMatchIndex - EXCERPT_RADIUS);
  const end = Math.min(content.length, firstMatchIndex + EXCERPT_RADIUS);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < content.length ? '...' : '';
  return `${prefix}${content.slice(start, end)}${suffix}`;
}

function scoreEntry(
  entry: SearchIndexEntry,
  normalizedQuery: string,
  queryTokens: string[],
  tokenizerConfig: SearchTokenizerConfig
): { score: number; matchedTokens: string[] } {
  const titleNormalized = normalizeSearchText(entry.title);
  const contentNormalized = normalizeSearchText(entry.content);
  const titleTokens = tokenizeWithConfig(entry.title, tokenizerConfig);
  const contentTokens = tokenizeWithConfig(entry.content, tokenizerConfig);

  let score = 0;
  const matchedTokens = new Set<string>();

  if (titleNormalized === normalizedQuery) {
    score += 220;
  } else if (titleNormalized.startsWith(normalizedQuery)) {
    score += 160;
  } else if (titleNormalized.includes(normalizedQuery)) {
    score += 110;
  }

  if (contentNormalized.includes(normalizedQuery)) {
    score += 35;
  }

  for (const token of queryTokens) {
    let matched = false;

    if (titleTokens.includes(token)) {
      score += 40;
      matched = true;
    } else if (titleNormalized.includes(token)) {
      score += 24;
      matched = true;
    }

    if (contentTokens.includes(token)) {
      score += 16;
      matched = true;
    } else if (contentNormalized.includes(token)) {
      score += 8;
      matched = true;
    }

    if (matched) {
      matchedTokens.add(token);
    }
  }

  if (matchedTokens.size === queryTokens.length && queryTokens.length > 0) {
    score += 30;
  }

  score += matchedTokens.size * 3;

  return {
    score,
    matchedTokens: [...matchedTokens]
  };
}

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function summarizePostTitle(post: CommunityPost): string {
  const content = post.content.trim();
  const preview = content.length > 84 ? `${content.slice(0, 84)}...` : content;
  const prefix = post.type === 'question' ? 'Question' : 'Post';
  return `${prefix}: ${preview}`;
}

export interface SearchService {
  search(actorId: string, query: string, type?: SearchEntityType): Promise<SearchResult[]>;
  indexBooking(booking: Booking): Promise<void>;
  indexUser(user: User): Promise<void>;
  indexPost(post: CommunityPost): Promise<void>;
  removeIndexEntry(type: SearchEntityType, entityId: string): Promise<void>;
  rebuildIndex(actorId: string): Promise<void>;
  debugListIndexEntries(type?: SearchEntityType): Promise<SearchIndexEntry[]>;
  getSearchConfig(actorId: string): Promise<SearchConfig>;
  updateSearchConfig(
    actorId: string,
    updates: {
      synonyms?: Record<string, string[]>;
      tokenizer?: Partial<SearchTokenizerConfig>;
    }
  ): Promise<SearchConfig>;
  getSynonyms(actorId: string): Promise<Record<string, string[]>>;
  updateSynonyms(actorId: string, synonyms: Record<string, string[]>): Promise<Record<string, string[]>>;
}

class LocalSearchService implements SearchService {
  private readonly searchRepository: SearchRepository;
  private readonly bookingRepository: BookingRepository;
  private readonly authRepository: AuthRepository;
  private readonly communityRepository: CommunityRepository;
  private hasCheckedInitialIndex = false;
  private searchConfigCache: SearchConfig | null = null;
  private synonymGraph: Map<string, Set<string>> = new Map();

  constructor(
    searchRepository: SearchRepository,
    bookingRepository: BookingRepository,
    authRepository: AuthRepository,
    communityRepository: CommunityRepository
  ) {
    this.searchRepository = searchRepository;
    this.bookingRepository = bookingRepository;
    this.authRepository = authRepository;
    this.communityRepository = communityRepository;
  }

  private async requireActiveAdmin(actorId: string): Promise<void> {
    const actor = await this.authRepository.findUserById(actorId);
    if (!actor || !actor.isActive) {
      throw new Error('Unauthorized');
    }

    if (actor.role !== 'admin') {
      throw new Error('Forbidden');
    }
  }

  private async ensureSearchConfigLoaded(): Promise<void> {
    if (this.searchConfigCache) {
      return;
    }

    const stored = await this.searchRepository.getSearchConfig();
    const normalized: SearchConfig = {
      synonyms: normalizeSynonyms(stored?.synonyms ?? DEFAULT_SYNONYMS),
      tokenizer: normalizeTokenizerConfig(stored?.tokenizer),
      updatedAt: Number.isFinite(stored?.updatedAt) ? stored!.updatedAt : nowMs()
    };
    this.searchConfigCache = normalized;
    this.synonymGraph = buildSynonymGraph(normalized.synonyms);
  }

  private getActiveSearchConfig(): SearchConfig {
    return (
      this.searchConfigCache ?? {
        synonyms: normalizeSynonyms(DEFAULT_SYNONYMS),
        tokenizer: normalizeTokenizerConfig(DEFAULT_TOKENIZER_CONFIG),
        updatedAt: nowMs()
      }
    );
  }

  private buildSearchTokens(value: string): string[] {
    const tokenizer = this.getActiveSearchConfig().tokenizer;
    return expandTokensWithSynonyms(tokenizeWithConfig(value, tokenizer), this.synonymGraph);
  }

  async getSearchConfig(actorId: string): Promise<SearchConfig> {
    await this.requireActiveAdmin(actorId);
    await this.ensureSearchConfigLoaded();
    const config = this.getActiveSearchConfig();
    return {
      synonyms: { ...config.synonyms },
      tokenizer: {
        ...config.tokenizer,
        stopwords: [...(config.tokenizer.stopwords ?? [])]
      },
      updatedAt: config.updatedAt
    };
  }

  async updateSearchConfig(
    actorId: string,
    updates: {
      synonyms?: Record<string, string[]>;
      tokenizer?: Partial<SearchTokenizerConfig>;
    }
  ): Promise<SearchConfig> {
    await this.requireActiveAdmin(actorId);
    await this.ensureSearchConfigLoaded();
    const current = this.getActiveSearchConfig();

    const next: SearchConfig = {
      synonyms:
        updates.synonyms !== undefined
          ? normalizeSynonyms(updates.synonyms)
          : normalizeSynonyms(current.synonyms),
      tokenizer:
        updates.tokenizer !== undefined
          ? normalizeTokenizerConfig({
              ...current.tokenizer,
              ...updates.tokenizer
            })
          : normalizeTokenizerConfig(current.tokenizer),
      updatedAt: nowMs()
    };

    await this.searchRepository.saveSearchConfig(next);
    this.searchConfigCache = next;
    this.synonymGraph = buildSynonymGraph(next.synonyms);

    return {
      synonyms: { ...next.synonyms },
      tokenizer: {
        ...next.tokenizer,
        stopwords: [...(next.tokenizer.stopwords ?? [])]
      },
      updatedAt: next.updatedAt
    };
  }

  async getSynonyms(actorId: string): Promise<Record<string, string[]>> {
    const config = await this.getSearchConfig(actorId);
    return { ...config.synonyms };
  }

  async updateSynonyms(
    actorId: string,
    synonyms: Record<string, string[]>
  ): Promise<Record<string, string[]>> {
    const config = await this.updateSearchConfig(actorId, { synonyms });
    return { ...config.synonyms };
  }

  async search(actorId: string, query: string, type?: SearchEntityType): Promise<SearchResult[]> {
    const actor = await this.requireActiveActor(actorId);
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    await this.ensureIndexReady(actor.role);
    await this.ensureSearchConfigLoaded();

    const queryTokens = tokenizeWithConfig(trimmedQuery, this.getActiveSearchConfig().tokenizer);
    if (queryTokens.length === 0) {
      return [];
    }

    const normalizedQuery = normalizeSearchText(trimmedQuery);
    const expandedQueryTokens = expandTokensWithSynonyms(queryTokens, this.synonymGraph);
    const entries = await this.searchRepository.listIndexEntries(type);
    const visibleEntries = await this.filterEntriesByActor(actor.id, actor.role, entries);
    if (ENABLE_SEARCH_DEBUG) {
      logger.info('SearchService query received', {
        context: 'SearchService',
        requestedType: type ?? 'all',
        indexedEntries: entries.length,
        visibleEntries: visibleEntries.length,
        actorRole: actor.role
      });
    }

    const scored = visibleEntries
      .map((entry) => {
        const { score, matchedTokens } = scoreEntry(
          entry,
          normalizedQuery,
          expandedQueryTokens,
          this.getActiveSearchConfig().tokenizer
        );
        if (score <= 0 || matchedTokens.length === 0) {
          return null;
        }

        const excerpt = buildExcerpt(entry.content, matchedTokens);

        return {
          result: {
            id: entry.id,
            entityId: parseEntityId(entry.id),
            type: entry.type,
            title: entry.title,
            excerpt,
            score,
            highlights: matchedTokens,
            metadata: entry.metadata,
            highlightedTitle: highlightText(entry.title, matchedTokens),
            highlightedExcerpt: highlightText(excerpt, matchedTokens)
          } as SearchResult,
          createdAt: entry.createdAt
        };
      })
      .filter(Boolean) as Array<{ result: SearchResult; createdAt: number }>;

    scored.sort((left, right) => {
      if (left.result.score !== right.result.score) {
        return right.result.score - left.result.score;
      }

      return right.createdAt - left.createdAt;
    });

    const results = scored.map((item) => item.result);
    if (ENABLE_SEARCH_DEBUG) {
      logger.info('SearchService query completed', {
        context: 'SearchService',
        requestedType: type ?? 'all',
        resultCount: results.length
      });
    }

    return results;
  }

  private async requireActiveActor(actorId: string): Promise<{ id: string; role: User['role'] }> {
    const actor = await this.authRepository.findUserById(actorId);
    if (!actor || !actor.isActive) {
      throw new Error('Unauthorized');
    }

    return {
      id: actor.id,
      role: actor.role
    };
  }

  private async filterEntriesByActor(
    actorId: string,
    actorRole: User['role'],
    entries: SearchIndexEntry[]
  ): Promise<SearchIndexEntry[]> {
    // User profile search results are admin-only.
    const entriesWithoutUsersForNonAdmin =
      actorRole === 'admin'
        ? entries
        : entries.filter((entry) => entry.type !== 'user');
    const entriesWithoutInactiveUsers = entriesWithoutUsersForNonAdmin.filter((entry) => {
      if (entry.type !== 'user') {
        return true;
      }

      return entry.metadata.isActive !== false;
    });

    const bookingEntries = entriesWithoutInactiveUsers.filter((entry) => entry.type === 'booking');
    if (bookingEntries.length === 0) {
      return entriesWithoutInactiveUsers;
    }

    if (actorRole === 'admin') {
      return entriesWithoutInactiveUsers;
    }

    if (actorRole === 'moderator') {
      return entriesWithoutInactiveUsers.filter((entry) => entry.type !== 'booking');
    }

    const accessibleBookingIds =
      actorRole === 'client'
        ? new Set((await this.bookingRepository.getBookingsByUser(actorId)).map((booking) => booking.id))
        : new Set((await this.bookingRepository.getBookingsByPhotographer(actorId)).map((booking) => booking.id));

    return entriesWithoutInactiveUsers.filter((entry) => {
      if (entry.type !== 'booking') {
        return true;
      }

      const bookingId = parseEntityId(entry.id);
      return accessibleBookingIds.has(bookingId);
    });
  }

  async indexBooking(booking: Booking): Promise<void> {
    if (booking.status === 'blocked') {
      await this.removeIndexEntry('booking', booking.id);
      return;
    }

    await this.ensureSearchConfigLoaded();

    const [services, users] = await Promise.all([
      this.bookingRepository.getServices(),
      this.authRepository.getAllUsers()
    ]);

    const servicesById = new Map(services.map((service) => [service.id, service]));
    const usersById = new Map(users.map((user) => [user.id, user]));
    const entry = this.toBookingIndexEntry(booking, servicesById, usersById);

    await this.searchRepository.upsertIndexEntry(entry);
    if (ENABLE_SEARCH_DEBUG) {
      logger.info('SearchService indexed item', {
        context: 'SearchService',
        type: 'booking',
        indexedCount: 1
      });
    }
    this.hasCheckedInitialIndex = true;
  }

  async indexUser(user: User): Promise<void> {
    if (!user.isActive) {
      await this.removeIndexEntry('user', user.id);
      return;
    }

    await this.ensureSearchConfigLoaded();
    const title = user.username;
    const statusText = user.isActive ? 'active' : 'disabled';
    const content = `${user.username} ${user.role} ${statusText} created ${formatDateTime(user.createdAt)}`;

    const entry: SearchIndexEntry = {
      id: buildEntryId('user', user.id),
      type: 'user',
      title,
      content,
      tokens: this.buildSearchTokens(`${title} ${content}`),
      createdAt: user.createdAt,
      metadata: {
        userId: user.id,
        username: user.username,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt
      }
    };

    await this.searchRepository.upsertIndexEntry(entry);
    if (ENABLE_SEARCH_DEBUG) {
      logger.info('SearchService indexed item', {
        context: 'SearchService',
        type: 'user',
        indexedCount: 1
      });
    }
    this.hasCheckedInitialIndex = true;
  }

  async indexPost(post: CommunityPost): Promise<void> {
    await this.ensureSearchConfigLoaded();
    const author = await this.authRepository.findUserById(post.authorId);
    const title = summarizePostTitle(post);
    const content = `${post.content} ${author?.username ?? ''} ${post.authorRole} ${post.type}`;

    const entry: SearchIndexEntry = {
      id: buildEntryId('post', post.id),
      type: 'post',
      title,
      content,
      tokens: this.buildSearchTokens(`${title} ${content}`),
      createdAt: post.createdAt,
      metadata: {
        postId: post.id,
        authorId: post.authorId,
        authorRole: post.authorRole,
        authorUsername: author?.username ?? null,
        postType: post.type,
        createdAt: post.createdAt
      }
    };

    await this.searchRepository.upsertIndexEntry(entry);
    if (ENABLE_SEARCH_DEBUG) {
      logger.info('SearchService indexed item', {
        context: 'SearchService',
        type: 'post',
        indexedCount: 1
      });
    }
    this.hasCheckedInitialIndex = true;
  }

  async removeIndexEntry(type: SearchEntityType, entityId: string): Promise<void> {
    await this.searchRepository.removeIndexEntry(type, entityId);
    if (ENABLE_SEARCH_DEBUG) {
      logger.info('SearchService removed index entry', {
        context: 'SearchService',
        type,
        removedCount: 1
      });
    }
    this.hasCheckedInitialIndex = true;
  }

  async rebuildIndex(actorId: string): Promise<void> {
    await this.requireActiveAdmin(actorId);
    await this.rebuildIndexInternal();
  }

  private async rebuildIndexInternal(): Promise<void> {
    await this.ensureSearchConfigLoaded();
    const [bookings, services, users, posts] = await Promise.all([
      this.bookingRepository.getAllBookings(),
      this.bookingRepository.getServices(),
      this.authRepository.getAllUsers(),
      this.communityRepository.getPosts()
    ]);

    const servicesById = new Map(services.map((service) => [service.id, service]));
    const usersById = new Map(users.map((user) => [user.id, user]));

    const bookingEntries = bookings
      .filter((booking) => booking.status !== 'blocked')
      .map((booking) => this.toBookingIndexEntry(booking, servicesById, usersById));

    const userEntries: SearchIndexEntry[] = users
      .filter((user) => user.isActive)
      .map((user) => {
      const statusText = user.isActive ? 'active' : 'disabled';
      const title = user.username;
      const content = `${user.username} ${user.role} ${statusText} created ${formatDateTime(user.createdAt)}`;

        return {
          id: buildEntryId('user', user.id),
          type: 'user',
          title,
          content,
          tokens: this.buildSearchTokens(`${title} ${content}`),
          createdAt: user.createdAt,
          metadata: {
            userId: user.id,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt
          }
        };
      });

    const postEntries: SearchIndexEntry[] = posts.map((post) => {
      const authorUsername = usersById.get(post.authorId)?.username ?? null;
      const title = summarizePostTitle(post);
      const content = `${post.content} ${authorUsername ?? ''} ${post.authorRole} ${post.type}`;

      return {
        id: buildEntryId('post', post.id),
        type: 'post',
        title,
        content,
        tokens: this.buildSearchTokens(`${title} ${content}`),
        createdAt: post.createdAt,
        metadata: {
          postId: post.id,
          authorId: post.authorId,
          authorRole: post.authorRole,
          authorUsername,
          postType: post.type,
          createdAt: post.createdAt
        }
      };
    });

    await this.searchRepository.resetIndex([...bookingEntries, ...userEntries, ...postEntries]);
    if (ENABLE_SEARCH_DEBUG) {
      logger.info('SearchService rebuild complete', {
        context: 'SearchService',
        bookings: bookingEntries.length,
        users: userEntries.length,
        posts: postEntries.length,
        total: bookingEntries.length + userEntries.length + postEntries.length
      });
    }
    this.hasCheckedInitialIndex = true;
  }

  async debugListIndexEntries(type?: SearchEntityType): Promise<SearchIndexEntry[]> {
    return this.searchRepository.listIndexEntries(type);
  }

  private async ensureIndexReady(actorRole: User['role']): Promise<void> {
    if (this.hasCheckedInitialIndex) {
      return;
    }

    const existing = await this.searchRepository.listIndexEntries();
    if (existing.length === 0) {
      if (actorRole === 'admin') {
        await this.rebuildIndexInternal();
      }
      return;
    }

    this.hasCheckedInitialIndex = true;
  }

  private toBookingIndexEntry(
    booking: Booking,
    servicesById: Map<string, { id: string; name: string }>,
    usersById: Map<string, { id: string; username: string }>
  ): SearchIndexEntry {
    const serviceName = servicesById.get(booking.serviceId)?.name ?? booking.serviceId;
    const clientName = usersById.get(booking.userId)?.username ?? booking.userId;
    const photographerName = usersById.get(booking.photographerId)?.username ?? booking.photographerId;

    const title = `${serviceName} · ${formatDateTime(booking.startTime)}`;
    const content = [
      serviceName,
      booking.status,
      `client ${clientName}`,
      `photographer ${photographerName}`,
      `starts ${formatDateTime(booking.startTime)}`,
      `ends ${formatDateTime(booking.endTime)}`
    ].join(' ');

    return {
      id: buildEntryId('booking', booking.id),
      type: 'booking',
      title,
      content,
      tokens: this.buildSearchTokens(`${title} ${content}`),
      createdAt: Number.isFinite(booking.createdAt) ? booking.createdAt : nowMs(),
      metadata: {
        bookingId: booking.id,
        serviceId: booking.serviceId,
        serviceName,
        clientId: booking.userId,
        clientUsername: clientName,
        photographerId: booking.photographerId,
        photographerName,
        status: booking.status,
        startTime: booking.startTime,
        endTime: booking.endTime
      }
    };
  }
}

export function createSearchService(
  searchRepository: SearchRepository,
  bookingRepository: BookingRepository,
  authRepository: AuthRepository,
  communityRepository: CommunityRepository
): SearchService {
  return new LocalSearchService(searchRepository, bookingRepository, authRepository, communityRepository);
}
