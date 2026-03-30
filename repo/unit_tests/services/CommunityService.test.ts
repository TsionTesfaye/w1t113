import type {
  AuthenticatedUser,
  CommunityComment,
  CommunityFavorite,
  CommunityFollow,
  CommunityLike,
  CommunityPost,
  CommunityReport,
  Session
} from '@/app/types/domain';
import type { AuthRepository } from '@/repositories/AuthRepository';
import type {
  CommunityLikeTargetType,
  CommunityReportTargetType,
  CommunityRepository,
  CommunityToggleFavoriteResult,
  CommunityToggleFollowResult,
  CommunityToggleLikeResult
} from '@/repositories/CommunityRepository';
import type { NotificationService } from '@/services/NotificationService';
import { createCommunityService } from '@/services/CommunityService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN_ID = 'admin-1';
const MODERATOR_ID = 'moderator-1';
const PHOTOGRAPHER_ID = 'photographer-1';
const CLIENT_A_ID = 'client-a';
const CLIENT_B_ID = 'client-b';

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

  async updateUser(userId: string, updates: { username?: string }): Promise<AuthenticatedUser> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    if (typeof updates.username === 'string') {
      user.username = updates.username.trim().toLowerCase();
    }

    return { ...user };
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

function collectDescendantCommentIds(comments: CommunityComment[], rootCommentId: string): Set<string> {
  const removable = new Set<string>([rootCommentId]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const comment of comments) {
      if (!comment.parentId || !removable.has(comment.parentId) || removable.has(comment.id)) {
        continue;
      }

      removable.add(comment.id);
      changed = true;
    }
  }

  return removable;
}

class InMemoryCommunityRepository implements CommunityRepository {
  posts: CommunityPost[] = [];
  comments: CommunityComment[] = [];
  likes: CommunityLike[] = [];
  favorites: CommunityFavorite[] = [];
  follows: CommunityFollow[] = [];
  reports: CommunityReport[] = [];

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
    const exists = this.posts.some((post) => post.id === postId);
    if (!exists) {
      return false;
    }

    this.posts = this.posts.filter((post) => post.id !== postId);

    const removedCommentIds = new Set(this.comments.filter((comment) => comment.postId === postId).map((comment) => comment.id));
    this.comments = this.comments.filter((comment) => comment.postId !== postId);

    this.likes = this.likes.filter((like) => {
      if (like.postId === postId) {
        return false;
      }

      return !(like.commentId && removedCommentIds.has(like.commentId));
    });

    this.favorites = this.favorites.filter((favorite) => favorite.postId !== postId);
    this.reports = this.reports.filter((report) => {
      if (report.targetType === 'post' && report.targetId === postId) {
        return false;
      }

      return !(report.targetType === 'comment' && removedCommentIds.has(report.targetId));
    });

    return true;
  }

  async createComment(comment: CommunityComment): Promise<void> {
    this.comments.push({ ...comment });
  }

  async getComments(postId: string): Promise<CommunityComment[]> {
    return this.comments
      .filter((comment) => comment.postId === postId)
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  async getAllComments(): Promise<CommunityComment[]> {
    return [...this.comments].sort((left, right) => left.createdAt - right.createdAt);
  }

  async getCommentById(commentId: string): Promise<CommunityComment | null> {
    return this.comments.find((comment) => comment.id === commentId) ?? null;
  }

  async deleteComment(commentId: string): Promise<boolean> {
    const target = this.comments.find((comment) => comment.id === commentId);
    if (!target) {
      return false;
    }

    const removableIds = collectDescendantCommentIds(this.comments, commentId);
    this.comments = this.comments.filter((comment) => !removableIds.has(comment.id));

    this.likes = this.likes.filter((like) => !(like.commentId && removableIds.has(like.commentId)));
    this.reports = this.reports.filter(
      (report) => !(report.targetType === 'comment' && removableIds.has(report.targetId))
    );

    const post = this.posts.find((candidate) => candidate.id === target.postId);
    if (post && post.acceptedAnswerId && removableIds.has(post.acceptedAnswerId)) {
      post.acceptedAnswerId = undefined;
    }

    return true;
  }

  async toggleLike(
    userId: string,
    targetType: CommunityLikeTargetType,
    targetId: string,
    createdAt: number
  ): Promise<CommunityToggleLikeResult> {
    const existing = this.likes.find((like) => {
      if (like.userId !== userId) {
        return false;
      }

      return targetType === 'post' ? like.postId === targetId : like.commentId === targetId;
    });

    if (existing) {
      this.likes = this.likes.filter((like) => like.id !== existing.id);

      if (targetType === 'post') {
        const post = this.posts.find((candidate) => candidate.id === targetId);
        if (!post) {
          throw new Error('POST_NOT_FOUND');
        }

        post.likeCount = Math.max(0, post.likeCount - 1);
        return {
          liked: false,
          likeCount: post.likeCount,
          like: null
        };
      }

      const comment = this.comments.find((candidate) => candidate.id === targetId);
      if (!comment) {
        throw new Error('COMMENT_NOT_FOUND');
      }

      comment.likeCount = Math.max(0, comment.likeCount - 1);
      return {
        liked: false,
        likeCount: comment.likeCount,
        like: null
      };
    }

    const like: CommunityLike = {
      id: `like-${crypto.randomUUID()}`,
      userId,
      postId: targetType === 'post' ? targetId : undefined,
      commentId: targetType === 'comment' ? targetId : undefined,
      createdAt
    };

    if (targetType === 'post') {
      const post = this.posts.find((candidate) => candidate.id === targetId);
      if (!post) {
        throw new Error('POST_NOT_FOUND');
      }

      post.likeCount += 1;
      this.likes.push(like);
      return {
        liked: true,
        likeCount: post.likeCount,
        like
      };
    }

    const comment = this.comments.find((candidate) => candidate.id === targetId);
    if (!comment) {
      throw new Error('COMMENT_NOT_FOUND');
    }

    comment.likeCount += 1;
    this.likes.push(like);
    return {
      liked: true,
      likeCount: comment.likeCount,
      like
    };
  }

  async getLikesForPost(postId: string): Promise<CommunityLike[]> {
    return this.likes.filter((like) => like.postId === postId);
  }

  async getLikesForComment(commentId: string): Promise<CommunityLike[]> {
    return this.likes.filter((like) => like.commentId === commentId);
  }

  async getAllLikes(): Promise<CommunityLike[]> {
    return [...this.likes];
  }

  async toggleFavorite(
    userId: string,
    postId: string,
    createdAt: number
  ): Promise<CommunityToggleFavoriteResult> {
    const post = this.posts.find((candidate) => candidate.id === postId);
    if (!post) {
      throw new Error('POST_NOT_FOUND');
    }

    const existing = this.favorites.find(
      (favorite) => favorite.userId === userId && favorite.postId === postId
    );

    if (existing) {
      this.favorites = this.favorites.filter((favorite) => favorite.id !== existing.id);
      post.favoriteCount = Math.max(0, post.favoriteCount - 1);
      return {
        saved: false,
        favoriteCount: post.favoriteCount,
        favorite: null
      };
    }

    const favorite: CommunityFavorite = {
      id: `favorite-${crypto.randomUUID()}`,
      userId,
      postId,
      createdAt
    };

    this.favorites.push(favorite);
    post.favoriteCount += 1;

    return {
      saved: true,
      favoriteCount: post.favoriteCount,
      favorite
    };
  }

  async getFavoritesByUser(userId: string): Promise<CommunityFavorite[]> {
    return this.favorites.filter((favorite) => favorite.userId === userId);
  }

  async getFavoritesForPost(postId: string): Promise<CommunityFavorite[]> {
    return this.favorites.filter((favorite) => favorite.postId === postId);
  }

  async getAllFavorites(): Promise<CommunityFavorite[]> {
    return [...this.favorites];
  }

  async toggleFollow(
    followerId: string,
    followingId: string,
    createdAt: number
  ): Promise<CommunityToggleFollowResult> {
    if (followerId === followingId) {
      throw new Error('SELF_FOLLOW_NOT_ALLOWED');
    }

    const existing = this.follows.find(
      (follow) => follow.followerId === followerId && follow.followingId === followingId
    );

    if (existing) {
      this.follows = this.follows.filter((follow) => follow.id !== existing.id);
      return {
        following: false,
        follow: null
      };
    }

    const follow: CommunityFollow = {
      id: `follow-${crypto.randomUUID()}`,
      followerId,
      followingId,
      createdAt
    };

    this.follows.push(follow);
    return {
      following: true,
      follow
    };
  }

  async getFollowingByUser(followerId: string): Promise<CommunityFollow[]> {
    return this.follows.filter((follow) => follow.followerId === followerId);
  }

  async getFollowersByUser(followingId: string): Promise<CommunityFollow[]> {
    return this.follows.filter((follow) => follow.followingId === followingId);
  }

  async getAllFollows(): Promise<CommunityFollow[]> {
    return [...this.follows];
  }

  async createReport(report: CommunityReport): Promise<boolean> {
    const duplicate = this.reports.some(
      (existing) =>
        existing.reporterId === report.reporterId &&
        existing.targetType === report.targetType &&
        existing.targetId === report.targetId
    );

    if (duplicate) {
      return false;
    }

    this.reports.push({ ...report });
    return true;
  }

  async getReportsByTarget(
    targetType: CommunityReportTargetType,
    targetId: string,
    status?: CommunityReport['status']
  ): Promise<CommunityReport[]> {
    return this.reports.filter(
      (report) =>
        report.targetType === targetType &&
        report.targetId === targetId &&
        (status ? report.status === status : true)
    );
  }

  async getAllReports(status?: CommunityReport['status']): Promise<CommunityReport[]> {
    return this.reports.filter((report) => (status ? report.status === status : true));
  }

  async getReportById(reportId: string): Promise<CommunityReport | null> {
    return this.reports.find((report) => report.id === reportId) ?? null;
  }

  async resolveReport(reportId: string): Promise<CommunityReport | null> {
    const report = this.reports.find((candidate) => candidate.id === reportId);
    if (!report) {
      return null;
    }

    report.status = 'resolved';
    return { ...report };
  }

  async markReportsResolved(targetType: CommunityReportTargetType, targetId: string): Promise<number> {
    let updatedCount = 0;

    for (const report of this.reports) {
      if (report.targetType !== targetType || report.targetId !== targetId || report.status !== 'open') {
        continue;
      }

      report.status = 'resolved';
      updatedCount += 1;
    }

    return updatedCount;
  }
}

function createUsers(): AuthenticatedUser[] {
  const baseTime = Date.now();
  const defaultNotificationPreferences = {
    booking: true,
    messages: true,
    community: true
  };

  return [
    {
      id: ADMIN_ID,
      username: 'admin',
      role: 'admin',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      notificationPreferences: defaultNotificationPreferences,
      blockedUserIds: [],
      createdAt: baseTime,
      failedAttempts: 0,
      lockUntil: null
    },
    {
      id: MODERATOR_ID,
      username: 'moderator',
      role: 'moderator',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      notificationPreferences: defaultNotificationPreferences,
      blockedUserIds: [],
      createdAt: baseTime,
      failedAttempts: 0,
      lockUntil: null
    },
    {
      id: PHOTOGRAPHER_ID,
      username: 'photographer',
      role: 'photographer',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      notificationPreferences: defaultNotificationPreferences,
      blockedUserIds: [],
      createdAt: baseTime,
      failedAttempts: 0,
      lockUntil: null
    },
    {
      id: CLIENT_A_ID,
      username: 'clienta',
      role: 'client',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      notificationPreferences: defaultNotificationPreferences,
      blockedUserIds: [],
      createdAt: baseTime,
      failedAttempts: 0,
      lockUntil: null
    },
    {
      id: CLIENT_B_ID,
      username: 'clientb',
      role: 'client',
      isActive: true,
      passwordHash: 'hash',
      salt: 'salt',
      notificationPreferences: defaultNotificationPreferences,
      blockedUserIds: [],
      createdAt: baseTime,
      failedAttempts: 0,
      lockUntil: null
    }
  ];
}

describe('CommunityService', () => {
  let repository: InMemoryCommunityRepository;
  let authRepository: InMemoryAuthRepository;
  let notificationService: NotificationService;
  let service: ReturnType<typeof createCommunityService>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 9, 0, 0, 0));

    repository = new InMemoryCommunityRepository();
    authRepository = new InMemoryAuthRepository(createUsers());
    notificationService = {
      createNotification: vi.fn(async () => null),
      getUserNotifications: vi.fn(async () => []),
      getNotificationPreference: vi.fn(async (userId: string) => ({
        userId,
        inAppEnabled: true,
        emailEnabled: false,
        smsEnabled: false
      })),
      updateNotificationPreference: vi.fn(
        async (
          userId: string,
          updates: Partial<{ inAppEnabled: boolean; emailEnabled: boolean; smsEnabled: boolean }>
        ) => ({
          userId,
          inAppEnabled: updates.inAppEnabled ?? true,
          emailEnabled: updates.emailEnabled ?? false,
          smsEnabled: updates.smsEnabled ?? false
        })
      ),
      markAsRead: vi.fn(async () => undefined),
      markAllAsRead: vi.fn(async () => undefined),
      getUnreadCount: vi.fn(async () => 0)
    };

    service = createCommunityService(repository, authRepository, notificationService);
  });

  it('creates posts and rejects empty post content', async () => {
    const created = await service.createPost(CLIENT_A_ID, 'client', '  Looking for portrait tips  ');

    expect(created.content).toBe('Looking for portrait tips');

    await expect(service.createPost(CLIENT_A_ID, 'client', '   ')).rejects.toMatchObject({
      code: 'INVALID_CONTENT'
    });
  });

  it('enforces post rate limit of 10 posts per hour', async () => {
    for (let index = 0; index < 10; index += 1) {
      await service.createPost(CLIENT_A_ID, 'client', `Post ${index}`);
    }

    await expect(service.createPost(CLIENT_A_ID, 'client', 'Post 11')).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED'
    });
  });

  it('allows posting again after rolling one-hour window passes', async () => {
    for (let index = 0; index < 10; index += 1) {
      await service.createPost(CLIENT_A_ID, 'client', `Window post ${index}`);
    }

    await expect(
      service.createPost(CLIENT_A_ID, 'client', 'Window blocked')
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED'
    });

    vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1_000);
    const created = await service.createPost(CLIENT_A_ID, 'client', 'Window reset');
    expect(created.content).toBe('Window reset');
  });

  it('creates comments, supports nesting, and enforces max depth 3', async () => {
    const post = await service.createPost(CLIENT_A_ID, 'client', 'Main thread');

    const root = await service.createComment(CLIENT_B_ID, 'client', post.id, null, 'Root reply');
    const depth1 = await service.createComment(CLIENT_A_ID, 'client', post.id, root.id, 'Depth 1');
    const depth2 = await service.createComment(CLIENT_B_ID, 'client', post.id, depth1.id, 'Depth 2');

    const depth3 = await service.createComment(CLIENT_A_ID, 'client', post.id, depth2.id, 'Depth 3');
    expect(depth3.parentId).toBe(depth2.id);

    await expect(
      service.createComment(CLIENT_B_ID, 'client', post.id, depth3.id, 'Depth 4 (too deep)')
    ).rejects.toMatchObject({
      code: 'REPLY_DEPTH_EXCEEDED'
    });
  });

  it('enforces comment rate limit of 30 comments per hour', async () => {
    const post = await service.createPost(CLIENT_A_ID, 'client', 'Rate limit thread');

    for (let index = 0; index < 30; index += 1) {
      await service.createComment(CLIENT_B_ID, 'client', post.id, null, `Comment ${index}`);
    }

    await expect(
      service.createComment(CLIENT_B_ID, 'client', post.id, null, 'Comment 31')
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED'
    });
  });

  it('allows commenting again after rolling one-hour window passes', async () => {
    const post = await service.createPost(CLIENT_A_ID, 'client', 'Comment window');

    for (let index = 0; index < 30; index += 1) {
      await service.createComment(CLIENT_B_ID, 'client', post.id, null, `Window comment ${index}`);
    }

    await expect(
      service.createComment(CLIENT_B_ID, 'client', post.id, null, 'Window blocked comment')
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED'
    });

    vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1_000);
    const created = await service.createComment(CLIENT_B_ID, 'client', post.id, null, 'Window reset comment');
    expect(created.content).toBe('Window reset comment');
  });

  it('toggles likes without creating duplicate active likes', async () => {
    const post = await service.createPost(CLIENT_A_ID, 'client', 'Like me');

    const first = await service.toggleLike(CLIENT_B_ID, 'post', post.id);
    expect(first.liked).toBe(true);
    expect(first.likeCount).toBe(1);

    const second = await service.toggleLike(CLIENT_B_ID, 'post', post.id);
    expect(second.liked).toBe(false);
    expect(second.likeCount).toBe(0);
  });

  it('prevents liking blocked users content', async () => {
    const actor = authRepository.users.find((user) => user.id === CLIENT_A_ID);
    if (!actor) {
      throw new Error('Test setup failed');
    }
    actor.blockedUserIds = [CLIENT_B_ID];

    const post = await service.createPost(CLIENT_B_ID, 'client', 'Blocked like target');
    await expect(service.toggleLike(CLIENT_A_ID, 'post', post.id)).rejects.toMatchObject({
      code: 'BLOCKED_INTERACTION'
    });

    expect(post.likeCount).toBe(0);
  });

  it('allows moderator/admin deletion but blocks normal users from deleting others content', async () => {
    const post = await service.createPost(CLIENT_A_ID, 'client', 'Needs moderation');

    await expect(service.deletePost(CLIENT_B_ID, 'client', post.id)).rejects.toMatchObject({
      code: 'FORBIDDEN'
    });

    await service.deletePost(MODERATOR_ID, 'moderator', post.id);
    const feedAfterModeratorDelete = await service.getFeed(CLIENT_A_ID);
    expect(feedAfterModeratorDelete).toHaveLength(0);

    const post2 = await service.createPost(CLIENT_A_ID, 'client', 'Another post');
    const comment = await service.createComment(CLIENT_B_ID, 'client', post2.id, null, 'Comment');

    await expect(service.deleteComment(CLIENT_A_ID, 'client', comment.id)).rejects.toMatchObject({
      code: 'FORBIDDEN'
    });

    await service.deleteComment(ADMIN_ID, 'admin', comment.id);
    const thread = await service.getPostThread(post2.id, CLIENT_A_ID);
    expect(thread.comments).toHaveLength(0);
  });

  it('creates reports and prevents duplicate reports by the same user on the same target', async () => {
    const post = await service.createPost(CLIENT_A_ID, 'client', 'Report target');

    const report = await service.reportContent(CLIENT_B_ID, 'client', 'post', post.id, 'Spam content');
    expect(report.status).toBe('open');

    await expect(
      service.reportContent(CLIENT_B_ID, 'client', 'post', post.id, 'Still spam')
    ).rejects.toMatchObject({
      code: 'DUPLICATE_REPORT'
    });
  });

  it('supports follow/unfollow and saved-post retrieval', async () => {
    const post = await service.createPost(CLIENT_B_ID, 'client', 'Follow and save me');

    const follow = await service.toggleFollow(CLIENT_A_ID, CLIENT_B_ID);
    expect(follow.following).toBe(true);

    const followingFeed = await service.getFollowingFeed(CLIENT_A_ID);
    expect(followingFeed.map((item) => item.post.id)).toContain(post.id);

    const unfollow = await service.toggleFollow(CLIENT_A_ID, CLIENT_B_ID);
    expect(unfollow.following).toBe(false);

    const followingFeedAfterUnfollow = await service.getFollowingFeed(CLIENT_A_ID);
    expect(followingFeedAfterUnfollow.map((item) => item.post.id)).not.toContain(post.id);

    const saved = await service.toggleFavorite(CLIENT_A_ID, post.id);
    expect(saved.saved).toBe(true);

    const savedPosts = await service.getSavedPosts(CLIENT_A_ID);
    expect(savedPosts.map((item) => item.post.id)).toContain(post.id);
  });

  it('allows question author to mark one accepted answer', async () => {
    const question = await service.createPost(CLIENT_A_ID, 'client', 'How to improve lighting?', 'question');
    const answer = await service.createComment(CLIENT_B_ID, 'client', question.id, null, 'Use a softbox.');

    const updated = await service.markAnswerAccepted(CLIENT_A_ID, 'client', question.id, answer.id);
    expect(updated.acceptedAnswerId).toBe(answer.id);

    const thread = await service.getPostThread(question.id, CLIENT_A_ID);
    const accepted = thread.comments.find((comment) => comment.comment.id === answer.id);
    expect(accepted?.isAcceptedAnswer).toBe(true);
  });

  it('rejects accepted answer operations on normal posts', async () => {
    const post = await service.createPost(CLIENT_A_ID, 'client', 'Standard post');
    const comment = await service.createComment(CLIENT_B_ID, 'client', post.id, null, 'A reply');

    await expect(service.markAnswerAccepted(CLIENT_A_ID, 'client', post.id, comment.id)).rejects.toMatchObject({
      code: 'INVALID_ANSWER_TARGET'
    });
  });
});
