import type {
  AuthenticatedUser,
  Booking,
  BookingStatus,
  CommunityComment,
  CommunityFavorite,
  CommunityFollow,
  CommunityLike,
  CommunityPost,
  CommunityReport,
  Photographer,
  ServiceItem,
  Session,
  SlotLock,
  User
} from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type { BookingRepository } from '@/repositories/BookingRepository';
import type {
  CommunityLikeTargetType,
  CommunityReportTargetType,
  CommunityRepository,
  CommunityToggleFavoriteResult,
  CommunityToggleFollowResult,
  CommunityToggleLikeResult
} from '@/repositories/CommunityRepository';
import type { SearchRepository } from '@/repositories/SearchRepository';
import { createSearchService, tokenize, tokenizeWithConfig } from '@/services/SearchService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
});

class InMemorySearchRepository implements SearchRepository {
  private readonly entries = new Map<string, {
    id: string;
    type: 'booking' | 'user' | 'post';
    title: string;
    content: string;
    tokens: string[];
    createdAt: number;
    metadata: Record<string, unknown>;
  }>();
  private synonyms: Record<string, string[]> | null = null;
  private tokenizer = {
    strategy: 'simple' as const,
    minTokenLength: 1,
    stopwords: [] as string[]
  };

  async upsertIndexEntry(entry: {
    id: string;
    type: 'booking' | 'user' | 'post';
    title: string;
    content: string;
    tokens: string[];
    createdAt: number;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    this.entries.set(entry.id, { ...entry });
  }

  async removeIndexEntry(type: 'booking' | 'user' | 'post', entityId: string): Promise<void> {
    this.entries.delete(`${type}:${entityId}`);
  }

  async listIndexEntries(type?: 'booking' | 'user' | 'post') {
    const values = [...this.entries.values()];
    const filtered = type ? values.filter((entry) => entry.type === type) : values;
    return filtered.sort((left, right) => right.createdAt - left.createdAt);
  }

  async resetIndex(entries: Array<{
    id: string;
    type: 'booking' | 'user' | 'post';
    title: string;
    content: string;
    tokens: string[];
    createdAt: number;
    metadata: Record<string, unknown>;
  }>): Promise<void> {
    this.entries.clear();
    for (const entry of entries) {
      this.entries.set(entry.id, { ...entry });
    }
  }

  async getSearchConfig() {
    return this.synonyms
      ? {
          synonyms: { ...this.synonyms },
          tokenizer: { ...this.tokenizer, stopwords: [...this.tokenizer.stopwords] },
          updatedAt: Date.now()
        }
      : null;
  }

  async saveSearchConfig(config: {
    synonyms: Record<string, string[]>;
    tokenizer: { strategy: 'whitespace' | 'simple' | 'alphanumeric'; minTokenLength: number; stopwords?: string[] };
    updatedAt: number;
  }): Promise<void> {
    this.synonyms = { ...config.synonyms };
    this.tokenizer = {
      strategy: config.tokenizer.strategy,
      minTokenLength: config.tokenizer.minTokenLength,
      stopwords: [...(config.tokenizer.stopwords ?? [])]
    };
  }

  async getSynonyms(): Promise<Record<string, string[]> | null> {
    return this.synonyms ? { ...this.synonyms } : null;
  }

  async saveSynonyms(synonyms: Record<string, string[]>): Promise<void> {
    this.synonyms = { ...synonyms };
  }
}

class InMemoryAuthRepository implements AuthRepository {
  users: AuthenticatedUser[] = [];
  sessions: Session[] = [];

  constructor(users: AuthenticatedUser[]) {
    this.users = users.map((user) => ({ ...user }));
  }

  async getUserByUsername(username: string): Promise<AuthenticatedUser | null> {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async findUserByUsername(username: string): Promise<AuthenticatedUser | null> {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async findUserById(userId: string): Promise<AuthenticatedUser | null> {
    return this.users.find((user) => user.id === userId) ?? null;
  }

  async getAllUsers(): Promise<AuthenticatedUser[]> {
    return [...this.users];
  }

  async listUsers(): Promise<AuthenticatedUser[]> {
    return [...this.users];
  }

  async createUser(user: AuthenticatedUser): Promise<void> {
    this.users.push({ ...user });
  }

  async updateUserRole(userId: string, role: AuthenticatedUser['role']): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    user.role = role;
    return { ...user };
  }

  async updateUserStatus(userId: string, isActive: boolean): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    user.isActive = isActive;
    return { ...user };
  }

  async updateLoginState(userId: string, failedAttempts: number, lockUntil: number | null): Promise<void> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      return;
    }

    user.failedAttempts = failedAttempts;
    user.lockUntil = lockUntil;
  }

  async createSession(session: Session): Promise<void> {
    this.sessions.push({ ...session });
  }

  async findSessionByToken(token: string): Promise<Session | null> {
    return this.sessions.find((session) => session.token === token) ?? null;
  }

  async deleteSessionByToken(token: string): Promise<void> {
    this.sessions = this.sessions.filter((session) => session.token !== token);
  }

  async purgeExpiredSessions(now: number): Promise<void> {
    this.sessions = this.sessions.filter((session) => session.expiresAt === null || session.expiresAt > now);
  }
}

class InMemoryBookingRepository implements BookingRepository {
  services: ServiceItem[] = [];
  bookings: Booking[] = [];

  constructor(services: ServiceItem[], bookings: Booking[]) {
    this.services = [...services];
    this.bookings = [...bookings];
  }

  async getServices(): Promise<ServiceItem[]> {
    return [...this.services];
  }

  async upsertServices(services: ServiceItem[]): Promise<void> {
    this.services = [...services];
  }

  async createServiceItem(service: ServiceItem): Promise<void> {
    this.services.push({ ...service });
  }

  async updateServiceItem(service: ServiceItem): Promise<void> {
    const index = this.services.findIndex((item) => item.id === service.id);
    if (index === -1) {
      throw new Error('SERVICE_NOT_FOUND');
    }

    this.services[index] = { ...service };
  }

  async archiveServiceItem(serviceId: string): Promise<ServiceItem | null> {
    const index = this.services.findIndex((item) => item.id === serviceId);
    if (index === -1) {
      return null;
    }

    const existing = this.services[index];
    if (!existing) {
      return null;
    }
    const archived: ServiceItem = {
      ...existing,
      isActive: false,
      updatedAt: Date.now()
    };
    this.services[index] = archived;
    return archived;
  }

  async getPhotographers(): Promise<Photographer[]> {
    return [];
  }

  async getBookingsForDay(dayKey: string): Promise<Booking[]> {
    return this.bookings.filter((booking) => booking.dayKey === dayKey);
  }

  async getAllBookings(): Promise<Booking[]> {
    return [...this.bookings];
  }

  async getBookingsByPhotographer(photographerId: string): Promise<Booking[]> {
    return this.bookings.filter((booking) => booking.photographerId === photographerId);
  }

  async getActiveLocksForDay(_dayKey: string, _now: number): Promise<SlotLock[]> {
    return [];
  }

  async getAllLocks(): Promise<SlotLock[]> {
    return [];
  }

  async getUserLock(_lockId: string, _userId: string, _now: number): Promise<SlotLock | null> {
    return null;
  }

  async getActiveLockByUser(_userId: string, _now: number): Promise<SlotLock | null> {
    return null;
  }

  async createLock(_lock: SlotLock, _now: number): Promise<SlotLock | null> {
    return null;
  }

  async deleteUserLock(_lockId: string, _userId: string): Promise<boolean> {
    return false;
  }

  async deleteLocksForPhotographerRange(
    _photographerId: string,
    _startTime: number,
    _endTime: number
  ): Promise<number> {
    return 0;
  }

  async deleteLocksForPhotographer(_photographerId: string): Promise<number> {
    return 0;
  }

  async deleteExpiredLocks(_now: number): Promise<number> {
    return 0;
  }

  async confirmLockAndCreateBooking(
    _lockId: string,
    _userId: string,
    _booking: Booking,
    _now: number
  ): Promise<Booking | null> {
    return null;
  }

  async createBookingDirect(_booking: Booking, _now: number): Promise<Booking | null> {
    return null;
  }

  async getBookingById(bookingId: string): Promise<Booking | null> {
    return this.bookings.find((booking) => booking.id === bookingId) ?? null;
  }

  async getBookingsByUser(userId: string): Promise<Booking[]> {
    return this.bookings.filter((booking) => booking.userId === userId);
  }

  async updateBookingStatus(bookingId: string, status: BookingStatus): Promise<Booking> {
    const booking = this.bookings.find((candidate) => candidate.id === bookingId);
    if (!booking) {
      throw new Error('BOOKING_NOT_FOUND');
    }

    booking.status = status;
    return booking;
  }
}

class InMemoryCommunityRepository implements CommunityRepository {
  posts: CommunityPost[] = [];

  constructor(posts: CommunityPost[]) {
    this.posts = [...posts];
  }

  async createPost(post: CommunityPost): Promise<void> {
    this.posts.push({ ...post });
  }

  async updatePost(post: CommunityPost): Promise<void> {
    const index = this.posts.findIndex((candidate) => candidate.id === post.id);
    if (index === -1) {
      this.posts.push({ ...post });
      return;
    }

    this.posts[index] = { ...post };
  }

  async getPosts(): Promise<CommunityPost[]> {
    return [...this.posts].sort((left, right) => right.createdAt - left.createdAt);
  }

  async getPostById(postId: string): Promise<CommunityPost | null> {
    return this.posts.find((post) => post.id === postId) ?? null;
  }

  async deletePost(postId: string): Promise<boolean> {
    const before = this.posts.length;
    this.posts = this.posts.filter((post) => post.id !== postId);
    return this.posts.length < before;
  }

  async createComment(_comment: CommunityComment): Promise<void> {
    return;
  }

  async getComments(_postId: string): Promise<CommunityComment[]> {
    return [];
  }

  async getAllComments(): Promise<CommunityComment[]> {
    return [];
  }

  async getCommentById(_commentId: string): Promise<CommunityComment | null> {
    return null;
  }

  async deleteComment(_commentId: string): Promise<boolean> {
    return false;
  }

  async toggleLike(
    _userId: string,
    _targetType: CommunityLikeTargetType,
    _targetId: string,
    _createdAt: number
  ): Promise<CommunityToggleLikeResult> {
    throw new Error('not implemented');
  }

  async getLikesForPost(_postId: string): Promise<CommunityLike[]> {
    return [];
  }

  async getLikesForComment(_commentId: string): Promise<CommunityLike[]> {
    return [];
  }

  async getAllLikes(): Promise<CommunityLike[]> {
    return [];
  }

  async toggleFavorite(
    _userId: string,
    _postId: string,
    _createdAt: number
  ): Promise<CommunityToggleFavoriteResult> {
    throw new Error('not implemented');
  }

  async getFavoritesByUser(_userId: string): Promise<CommunityFavorite[]> {
    return [];
  }

  async getFavoritesForPost(_postId: string): Promise<CommunityFavorite[]> {
    return [];
  }

  async getAllFavorites(): Promise<CommunityFavorite[]> {
    return [];
  }

  async toggleFollow(
    _followerId: string,
    _followingId: string,
    _createdAt: number
  ): Promise<CommunityToggleFollowResult> {
    throw new Error('not implemented');
  }

  async getFollowingByUser(_followerId: string): Promise<CommunityFollow[]> {
    return [];
  }

  async getFollowersByUser(_followingId: string): Promise<CommunityFollow[]> {
    return [];
  }

  async getAllFollows(): Promise<CommunityFollow[]> {
    return [];
  }

  async createReport(_report: CommunityReport): Promise<boolean> {
    return false;
  }

  async getReportsByTarget(
    _targetType: CommunityReportTargetType,
    _targetId: string,
    _status?: CommunityReport['status']
  ): Promise<CommunityReport[]> {
    return [];
  }

  async getAllReports(_status?: CommunityReport['status']): Promise<CommunityReport[]> {
    return [];
  }

  async markReportsResolved(_targetType: CommunityReportTargetType, _targetId: string): Promise<number> {
    return 0;
  }
}

function createUsers(now: number): AuthenticatedUser[] {
  return [
    {
      id: 'user-alex',
      username: 'alex',
      role: 'client',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      createdAt: now,
      failedAttempts: 0,
      lockUntil: null
    },
    {
      id: 'user-alexander',
      username: 'alexander',
      role: 'photographer',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      createdAt: now - 1_000,
      failedAttempts: 0,
      lockUntil: null
    },
    {
      id: 'admin-1',
      username: 'admin',
      role: 'admin',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      createdAt: now - 2_000,
      failedAttempts: 0,
      lockUntil: null
    }
  ];
}

function createServices(): ServiceItem[] {
  const now = Date.now();
  return [
    {
      id: 'service-1',
      name: 'Headshots - 30 min - $175',
      durationMinutes: 30,
      price: 175,
      isActive: true,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function createBookings(now: number): Booking[] {
  return [
    {
      id: 'booking-1',
      userId: 'user-alex',
      photographerId: 'user-alexander',
      serviceId: 'service-1',
      slotId: 'slot-1',
      startTime: now + 3_600_000,
      endTime: now + 5_400_000,
      dayKey: '2026-03-29',
      status: 'confirmed',
      createdAt: now
    }
  ];
}

function createPosts(now: number): CommunityPost[] {
  return [
    {
      id: 'post-1',
      authorId: 'user-alex',
      authorRole: 'client',
      type: 'post',
      content: 'Family session at 9 AM is available',
      createdAt: now,
      likeCount: 0,
      favoriteCount: 0
    }
  ];
}

describe('SearchService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 9, 0, 0, 0));
  });

  it('tokenizes text with normalization and punctuation removal', () => {
    const tokens = tokenize('Family Session at 9 AM!');
    expect(tokens).toEqual(['family', 'session', 'at', '9', 'am']);
  });

  it('applies tokenizer strategy, minimum length, and stopword filtering from config', () => {
    const whitespaceTokens = tokenizeWithConfig('A/B Session @ Studio', {
      strategy: 'whitespace',
      minTokenLength: 1,
      stopwords: []
    });
    const alphanumericTokens = tokenizeWithConfig('A/B Session @ Studio', {
      strategy: 'alphanumeric',
      minTokenLength: 2,
      stopwords: ['studio']
    });

    expect(whitespaceTokens).toContain('a/b');
    expect(alphanumericTokens).toEqual(['session']);
  });

  it('returns no results for empty query and no matches for unmatched query', async () => {
    const now = Date.now();
    const service = createSearchService(
      new InMemorySearchRepository(),
      new InMemoryBookingRepository(createServices(), createBookings(now)),
      new InMemoryAuthRepository(createUsers(now)),
      new InMemoryCommunityRepository(createPosts(now))
    );

    const empty = await service.search('admin-1', '   ');
    expect(empty).toEqual([]);

    await service.rebuildIndex('admin-1');
    const noMatches = await service.search('admin-1', 'zzzz-not-found');
    expect(noMatches).toEqual([]);
  });

  it('applies case-insensitive and partial matching for posts', async () => {
    const now = Date.now();
    const service = createSearchService(
      new InMemorySearchRepository(),
      new InMemoryBookingRepository(createServices(), createBookings(now)),
      new InMemoryAuthRepository(createUsers(now)),
      new InMemoryCommunityRepository(createPosts(now))
    );

    await service.rebuildIndex('admin-1');

    const results = await service.search('admin-1', 'fAmIlY sess', 'post');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.type).toBe('post');
    expect(results[0]?.highlightedExcerpt).toContain('<mark>');
  });

  it('returns matches for single-character queries', async () => {
    const now = Date.now();
    const service = createSearchService(
      new InMemorySearchRepository(),
      new InMemoryBookingRepository(createServices(), createBookings(now)),
      new InMemoryAuthRepository(createUsers(now)),
      new InMemoryCommunityRepository(createPosts(now))
    );

    await service.rebuildIndex('admin-1');
    const results = await service.search('admin-1', 'a');
    expect(results.length).toBeGreaterThan(0);
  });

  it('ranks exact title match above partial match', async () => {
    const now = Date.now();
    const users = createUsers(now);
    const searchRepository = new InMemorySearchRepository();
    const service = createSearchService(
      searchRepository,
      new InMemoryBookingRepository(createServices(), createBookings(now)),
      new InMemoryAuthRepository(users),
      new InMemoryCommunityRepository(createPosts(now))
    );

    const exactUser: User = {
      id: 'u-1',
      username: 'alex',
      role: 'client',
      isActive: true,
      createdAt: now,
      failedAttempts: 0,
      lockUntil: null
    };

    const partialUser: User = {
      id: 'u-2',
      username: 'alexander-pro',
      role: 'client',
      isActive: true,
      createdAt: now,
      failedAttempts: 0,
      lockUntil: null
    };

    await service.indexUser(exactUser);
    await service.indexUser(partialUser);

    const results = await service.search('admin-1', 'alex', 'user');
    expect(results[0]?.entityId).toBe('u-1');
    expect(results[0]?.score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
  });

  it('rebuilds index from bookings, users, and posts and supports typed lookup', async () => {
    const now = Date.now();
    const service = createSearchService(
      new InMemorySearchRepository(),
      new InMemoryBookingRepository(createServices(), createBookings(now)),
      new InMemoryAuthRepository(createUsers(now)),
      new InMemoryCommunityRepository(createPosts(now))
    );

    await service.rebuildIndex('admin-1');

    const bookingResults = await service.search('admin-1', 'headshots', 'booking');
    expect(bookingResults.length).toBeGreaterThan(0);
    expect(bookingResults[0]?.type).toBe('booking');

    const userResults = await service.search('admin-1', 'alex', 'user');
    expect(userResults.length).toBeGreaterThan(0);
    expect(userResults[0]?.type).toBe('user');

    const postResults = await service.search('admin-1', 'family', 'post');
    expect(postResults.length).toBeGreaterThan(0);
    expect(postResults[0]?.type).toBe('post');
  });

  it('supports default and admin-configured synonyms during querying', async () => {
    const now = Date.now();
    const searchRepository = new InMemorySearchRepository();
    const service = createSearchService(
      searchRepository,
      new InMemoryBookingRepository(createServices(), createBookings(now)),
      new InMemoryAuthRepository(createUsers(now)),
      new InMemoryCommunityRepository(createPosts(now))
    );

    await service.rebuildIndex('admin-1');

    const defaultSynonymResults = await service.search('admin-1', 'customer', 'user');
    expect(defaultSynonymResults.length).toBeGreaterThan(0);
    expect(defaultSynonymResults[0]?.type).toBe('user');

    await service.updateSynonyms('admin-1', {
      photographer: ['camera']
    });

    const configuredSynonymResults = await service.search('admin-1', 'camera', 'user');
    expect(configuredSynonymResults.some((result) => result.entityId === 'user-alexander')).toBe(true);
  });

  it('changes query results when tokenizer config is updated and index is rebuilt', async () => {
    const now = Date.now();
    const searchRepository = new InMemorySearchRepository();
    const service = createSearchService(
      searchRepository,
      new InMemoryBookingRepository(createServices(), createBookings(now)),
      new InMemoryAuthRepository(createUsers(now)),
      new InMemoryCommunityRepository(createPosts(now))
    );

    await service.updateSearchConfig('admin-1', {
      tokenizer: {
        strategy: 'simple',
        minTokenLength: 5,
        stopwords: []
      }
    });
    await service.rebuildIndex('admin-1');
    const strictResults = await service.search('admin-1', 'alex', 'user');
    expect(strictResults).toEqual([]);

    await service.updateSearchConfig('admin-1', {
      tokenizer: {
        strategy: 'simple',
        minTokenLength: 1,
        stopwords: []
      }
    });
    await service.rebuildIndex('admin-1');
    const relaxedResults = await service.search('admin-1', 'alex', 'user');
    expect(relaxedResults.length).toBeGreaterThan(0);
  });

  it('removes stale index entries after entity deletion', async () => {
    const now = Date.now();
    const searchRepository = new InMemorySearchRepository();
    const service = createSearchService(
      searchRepository,
      new InMemoryBookingRepository(createServices(), createBookings(now)),
      new InMemoryAuthRepository(createUsers(now)),
      new InMemoryCommunityRepository(createPosts(now))
    );

    await service.rebuildIndex('admin-1');
    const before = await service.search('admin-1', 'family', 'post');
    expect(before.length).toBeGreaterThan(0);

    await service.removeIndexEntry('post', 'post-1');

    const after = await service.search('admin-1', 'family', 'post');
    expect(after).toEqual([]);
  });

  it('enforces booking search visibility by actor role and ownership', async () => {
    const now = Date.now();
    const users = createUsers(now).concat([
      {
        id: 'moderator-1',
        username: 'moderator',
        role: 'moderator',
        isActive: true,
        passwordHash: 'hash',
        salt: 'salt',
        createdAt: now - 3_000,
        failedAttempts: 0,
        lockUntil: null
      },
      {
        id: 'user-other-client',
        username: 'charlie',
        role: 'client',
        isActive: true,
        passwordHash: 'hash',
        salt: 'salt',
        createdAt: now - 4_000,
        failedAttempts: 0,
        lockUntil: null
      }
    ]);
    const bookings: Booking[] = [
      ...createBookings(now),
      {
        id: 'booking-2',
        userId: 'user-other-client',
        photographerId: 'user-alexander',
        serviceId: 'service-1',
        slotId: 'slot-2',
        startTime: now + 7_200_000,
        endTime: now + 9_000_000,
        dayKey: '2026-03-29',
        status: 'confirmed',
        createdAt: now + 1
      }
    ];

    const service = createSearchService(
      new InMemorySearchRepository(),
      new InMemoryBookingRepository(createServices(), bookings),
      new InMemoryAuthRepository(users),
      new InMemoryCommunityRepository(createPosts(now))
    );

    await service.rebuildIndex('admin-1');

    const adminResults = await service.search('admin-1', 'headshots', 'booking');
    expect(adminResults.map((result) => result.entityId).sort()).toEqual(['booking-1', 'booking-2']);

    const clientResults = await service.search('user-alex', 'headshots', 'booking');
    expect(clientResults.map((result) => result.entityId)).toEqual(['booking-1']);

    const photographerResults = await service.search('user-alexander', 'headshots', 'booking');
    expect(photographerResults.map((result) => result.entityId).sort()).toEqual(['booking-1', 'booking-2']);

    const moderatorResults = await service.search('moderator-1', 'headshots', 'booking');
    expect(moderatorResults).toEqual([]);
  });

  it('excludes user-profile search results for non-admin actors', async () => {
    const now = Date.now();
    const users = createUsers(now);
    const service = createSearchService(
      new InMemorySearchRepository(),
      new InMemoryBookingRepository(createServices(), createBookings(now)),
      new InMemoryAuthRepository(users),
      new InMemoryCommunityRepository(createPosts(now))
    );

    await service.rebuildIndex('admin-1');

    const clientResults = await service.search('user-alex', 'alex', 'user');
    expect(clientResults).toEqual([]);
    expect(clientResults.some((result) => result.type === 'user')).toBe(false);
  });

  it('requires admin actor for explicit rebuildIndex calls', async () => {
    const now = Date.now();
    const service = createSearchService(
      new InMemorySearchRepository(),
      new InMemoryBookingRepository(createServices(), createBookings(now)),
      new InMemoryAuthRepository(createUsers(now)),
      new InMemoryCommunityRepository(createPosts(now))
    );

    await expect(service.rebuildIndex('user-alex')).rejects.toThrow('Forbidden');
    await expect(service.rebuildIndex('admin-1')).resolves.toBeUndefined();
  });

  it('does not expose deactivated users in search results', async () => {
    const now = Date.now();
    const users = createUsers(now).map((user) =>
      user.id === 'user-alexander'
        ? { ...user, isActive: false }
        : user
    );
    const service = createSearchService(
      new InMemorySearchRepository(),
      new InMemoryBookingRepository(createServices(), createBookings(now)),
      new InMemoryAuthRepository(users),
      new InMemoryCommunityRepository(createPosts(now))
    );

    await service.rebuildIndex('admin-1');
    const results = await service.search('admin-1', 'alex', 'user');
    expect(results.some((result) => result.entityId === 'user-alexander')).toBe(false);
  });
});
