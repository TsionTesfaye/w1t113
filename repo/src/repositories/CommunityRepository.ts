import type {
  CommunityComment,
  CommunityFavorite,
  CommunityFollow,
  CommunityLike,
  CommunityPost,
  CommunityReport,
  UserRole
} from '@/app/types/domain';
import { indexedDbClient } from '@/db/indexedDbClient';

export type CommunityLikeTargetType = 'post' | 'comment';
export type CommunityReportTargetType = 'post' | 'comment';

export interface CommunityToggleLikeResult {
  liked: boolean;
  likeCount: number;
  like: CommunityLike | null;
}

export interface CommunityToggleFavoriteResult {
  saved: boolean;
  favoriteCount: number;
  favorite: CommunityFavorite | null;
}

export interface CommunityToggleFollowResult {
  following: boolean;
  follow: CommunityFollow | null;
}

export interface CommunityRepository {
  createPost(post: CommunityPost): Promise<void>;
  updatePost(post: CommunityPost): Promise<void>;
  getPosts(): Promise<CommunityPost[]>;
  getPostById(postId: string): Promise<CommunityPost | null>;
  deletePost(postId: string): Promise<boolean>;
  createComment(comment: CommunityComment): Promise<void>;
  getComments(postId: string): Promise<CommunityComment[]>;
  getAllComments(): Promise<CommunityComment[]>;
  getCommentById(commentId: string): Promise<CommunityComment | null>;
  deleteComment(commentId: string): Promise<boolean>;
  toggleLike(
    userId: string,
    targetType: CommunityLikeTargetType,
    targetId: string,
    createdAt: number
  ): Promise<CommunityToggleLikeResult>;
  getLikesForPost(postId: string): Promise<CommunityLike[]>;
  getLikesForComment(commentId: string): Promise<CommunityLike[]>;
  getAllLikes(): Promise<CommunityLike[]>;
  toggleFavorite(userId: string, postId: string, createdAt: number): Promise<CommunityToggleFavoriteResult>;
  getFavoritesByUser(userId: string): Promise<CommunityFavorite[]>;
  getFavoritesForPost(postId: string): Promise<CommunityFavorite[]>;
  getAllFavorites(): Promise<CommunityFavorite[]>;
  toggleFollow(
    followerId: string,
    followingId: string,
    createdAt: number
  ): Promise<CommunityToggleFollowResult>;
  getFollowingByUser(followerId: string): Promise<CommunityFollow[]>;
  getFollowersByUser(followingId: string): Promise<CommunityFollow[]>;
  getAllFollows(): Promise<CommunityFollow[]>;
  createReport(report: CommunityReport): Promise<boolean>;
  getReportById(reportId: string): Promise<CommunityReport | null>;
  getReportsByTarget(
    targetType: CommunityReportTargetType,
    targetId: string,
    status?: CommunityReport['status']
  ): Promise<CommunityReport[]>;
  getAllReports(status?: CommunityReport['status']): Promise<CommunityReport[]>;
  resolveReport(reportId: string): Promise<CommunityReport | null>;
  markReportsResolved(targetType: CommunityReportTargetType, targetId: string): Promise<number>;
}

interface LegacyCommunityPost extends Partial<CommunityPost> {
  title?: unknown;
  body?: unknown;
  acceptedAnswerCommentId?: unknown;
}

interface LegacyCommunityComment extends Partial<CommunityComment> {
  body?: unknown;
  parentCommentId?: unknown;
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const asNumber = Number.parseInt(value, 10);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function normalizeRole(value: unknown): UserRole {
  if (value === 'admin' || value === 'client' || value === 'photographer' || value === 'moderator') {
    return value;
  }

  return 'client';
}

function normalizePost(record: LegacyCommunityPost | undefined): CommunityPost | null {
  if (!record || typeof record.id !== 'string' || typeof record.authorId !== 'string') {
    return null;
  }

  const legacyTitle = typeof record.title === 'string' ? record.title.trim() : '';
  const legacyBody = typeof record.body === 'string' ? record.body.trim() : '';
  const fallbackContent = [legacyTitle, legacyBody].filter(Boolean).join('\n').trim();

  return {
    id: record.id,
    authorId: record.authorId,
    authorRole: normalizeRole(record.authorRole),
    type: record.type === 'question' ? 'question' : 'post',
    content: typeof record.content === 'string' ? record.content : fallbackContent,
    createdAt: toTimestamp(record.createdAt),
    likeCount:
      typeof record.likeCount === 'number' && Number.isFinite(record.likeCount)
        ? Math.max(0, Math.floor(record.likeCount))
        : 0,
    favoriteCount:
      typeof record.favoriteCount === 'number' && Number.isFinite(record.favoriteCount)
        ? Math.max(0, Math.floor(record.favoriteCount))
        : 0,
    acceptedAnswerId:
      typeof record.acceptedAnswerId === 'string'
        ? record.acceptedAnswerId
        : typeof record.acceptedAnswerCommentId === 'string'
          ? record.acceptedAnswerCommentId
          : undefined
  };
}

function normalizeComment(record: LegacyCommunityComment | undefined): CommunityComment | null {
  if (
    !record ||
    typeof record.id !== 'string' ||
    typeof record.postId !== 'string' ||
    typeof record.authorId !== 'string'
  ) {
    return null;
  }

  const parentIdCandidate =
    typeof record.parentId === 'string'
      ? record.parentId
      : typeof record.parentCommentId === 'string'
        ? record.parentCommentId
        : null;

  return {
    id: record.id,
    postId: record.postId,
    authorId: record.authorId,
    authorRole: normalizeRole(record.authorRole),
    parentId: parentIdCandidate,
    content:
      typeof record.content === 'string'
        ? record.content
        : typeof record.body === 'string'
          ? record.body
          : '',
    createdAt: toTimestamp(record.createdAt),
    likeCount:
      typeof record.likeCount === 'number' && Number.isFinite(record.likeCount)
        ? Math.max(0, Math.floor(record.likeCount))
        : 0
  };
}

function normalizeLike(record: Partial<CommunityLike> | undefined): CommunityLike | null {
  if (!record || typeof record.id !== 'string' || typeof record.userId !== 'string') {
    return null;
  }

  if (typeof record.postId !== 'string' && typeof record.commentId !== 'string') {
    return null;
  }

  return {
    id: record.id,
    userId: record.userId,
    postId: typeof record.postId === 'string' ? record.postId : undefined,
    commentId: typeof record.commentId === 'string' ? record.commentId : undefined,
    createdAt: toTimestamp(record.createdAt)
  };
}

function normalizeFavorite(record: Partial<CommunityFavorite> | undefined): CommunityFavorite | null {
  if (
    !record ||
    typeof record.id !== 'string' ||
    typeof record.userId !== 'string' ||
    typeof record.postId !== 'string'
  ) {
    return null;
  }

  return {
    id: record.id,
    userId: record.userId,
    postId: record.postId,
    createdAt: toTimestamp(record.createdAt)
  };
}

function normalizeFollow(record: Partial<CommunityFollow> | undefined): CommunityFollow | null {
  if (
    !record ||
    typeof record.id !== 'string' ||
    typeof record.followerId !== 'string' ||
    typeof record.followingId !== 'string'
  ) {
    return null;
  }

  return {
    id: record.id,
    followerId: record.followerId,
    followingId: record.followingId,
    createdAt: toTimestamp(record.createdAt)
  };
}

function normalizeReport(record: Partial<CommunityReport> | undefined): CommunityReport | null {
  if (
    !record ||
    typeof record.id !== 'string' ||
    typeof record.targetId !== 'string' ||
    typeof record.reason !== 'string'
  ) {
    return null;
  }

  const reporterId =
    typeof record.reporterId === 'string'
      ? record.reporterId
      : typeof (record as { userId?: unknown }).userId === 'string'
        ? ((record as { userId?: string }).userId as string)
        : null;

  const targetType =
    record.targetType === 'post' || record.targetType === 'comment'
      ? record.targetType
      : (record as { type?: unknown }).type === 'post' || (record as { type?: unknown }).type === 'comment'
        ? ((record as { type?: 'post' | 'comment' }).type as 'post' | 'comment')
        : null;

  if (!reporterId || !targetType) {
    return null;
  }

  return {
    id: record.id,
    reporterId,
    targetId: record.targetId,
    targetType,
    reason: record.reason,
    createdAt: toTimestamp(record.createdAt),
    status: record.status === 'resolved' ? 'resolved' : 'open'
  };
}

function sortByNewest<T extends { createdAt: number }>(records: T[]): T[] {
  return [...records].sort((left, right) => right.createdAt - left.createdAt);
}

function sortCommentsOldestFirst(comments: CommunityComment[]): CommunityComment[] {
  return [...comments].sort((left, right) => left.createdAt - right.createdAt);
}

function collectDescendantCommentIds(comments: CommunityComment[], rootCommentId: string): Set<string> {
  const ids = new Set<string>([rootCommentId]);
  let didChange = true;

  while (didChange) {
    didChange = false;

    for (const comment of comments) {
      if (!comment.parentId || !ids.has(comment.parentId) || ids.has(comment.id)) {
        continue;
      }

      ids.add(comment.id);
      didChange = true;
    }
  }

  return ids;
}

function isLikeTargetMatch(
  like: CommunityLike,
  targetType: CommunityLikeTargetType,
  targetId: string
): boolean {
  if (targetType === 'post') {
    return like.postId === targetId;
  }

  return like.commentId === targetId;
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

class IndexedDbCommunityRepository implements CommunityRepository {
  async createPost(post: CommunityPost): Promise<void> {
    await indexedDbClient.withTransaction(['posts'], 'readwrite', async (transaction) => {
      await transaction.put('posts', post);
    });
  }

  async updatePost(post: CommunityPost): Promise<void> {
    await indexedDbClient.withTransaction(['posts'], 'readwrite', async (transaction) => {
      await transaction.put('posts', post);
    });
  }

  async getPosts(): Promise<CommunityPost[]> {
    return indexedDbClient.withTransaction(['posts'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<LegacyCommunityPost>('posts');
      const posts = records.map((record) => normalizePost(record)).filter(Boolean) as CommunityPost[];
      return sortByNewest(posts);
    });
  }

  async getPostById(postId: string): Promise<CommunityPost | null> {
    return indexedDbClient.withTransaction(['posts'], 'readonly', async (transaction) => {
      const record = await transaction.get<LegacyCommunityPost>('posts', postId);
      return normalizePost(record);
    });
  }

  async deletePost(postId: string): Promise<boolean> {
    return indexedDbClient.withTransaction(
      ['posts', 'comments', 'likes', 'favorites', 'reports'],
      'readwrite',
      async (transaction) => {
        const postRecord = await transaction.get<LegacyCommunityPost>('posts', postId);
        const post = normalizePost(postRecord);
        if (!post) {
          return false;
        }

        await transaction.delete('posts', postId);

        const commentRecords = await transaction.getAll<LegacyCommunityComment>('comments');
        const comments = commentRecords
          .map((record) => normalizeComment(record))
          .filter(Boolean) as CommunityComment[];
        const commentIds = comments
          .filter((comment) => comment.postId === postId)
          .map((comment) => comment.id);

        for (const commentId of commentIds) {
          await transaction.delete('comments', commentId);
        }

        const commentIdSet = new Set(commentIds);

        const likeRecords = await transaction.getAll<Partial<CommunityLike>>('likes');
        const likes = likeRecords.map((record) => normalizeLike(record)).filter(Boolean) as CommunityLike[];
        for (const like of likes) {
          if (like.postId === postId || (like.commentId && commentIdSet.has(like.commentId))) {
            await transaction.delete('likes', like.id);
          }
        }

        const favoriteRecords = await transaction.getAll<Partial<CommunityFavorite>>('favorites');
        const favorites = favoriteRecords
          .map((record) => normalizeFavorite(record))
          .filter(Boolean) as CommunityFavorite[];
        for (const favorite of favorites) {
          if (favorite.postId === postId) {
            await transaction.delete('favorites', favorite.id);
          }
        }

        const reportRecords = await transaction.getAll<Partial<CommunityReport>>('reports');
        const reports = reportRecords
          .map((record) => normalizeReport(record))
          .filter(Boolean) as CommunityReport[];
        for (const report of reports) {
          if (report.targetType === 'post' && report.targetId === postId) {
            await transaction.delete('reports', report.id);
            continue;
          }

          if (report.targetType === 'comment' && commentIdSet.has(report.targetId)) {
            await transaction.delete('reports', report.id);
          }
        }

        return true;
      }
    );
  }

  async createComment(comment: CommunityComment): Promise<void> {
    await indexedDbClient.withTransaction(['comments'], 'readwrite', async (transaction) => {
      await transaction.put('comments', comment);
    });
  }

  async getComments(postId: string): Promise<CommunityComment[]> {
    return indexedDbClient.withTransaction(['comments'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<LegacyCommunityComment>('comments');
      const comments = records
        .map((record) => normalizeComment(record))
        .filter((comment): comment is CommunityComment => Boolean(comment && comment.postId === postId));

      return sortCommentsOldestFirst(comments);
    });
  }

  async getAllComments(): Promise<CommunityComment[]> {
    return indexedDbClient.withTransaction(['comments'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<LegacyCommunityComment>('comments');
      const comments = records
        .map((record) => normalizeComment(record))
        .filter(Boolean) as CommunityComment[];
      return sortCommentsOldestFirst(comments);
    });
  }

  async getCommentById(commentId: string): Promise<CommunityComment | null> {
    return indexedDbClient.withTransaction(['comments'], 'readonly', async (transaction) => {
      const record = await transaction.get<LegacyCommunityComment>('comments', commentId);
      return normalizeComment(record);
    });
  }

  async deleteComment(commentId: string): Promise<boolean> {
    return indexedDbClient.withTransaction(
      ['comments', 'likes', 'reports', 'posts'],
      'readwrite',
      async (transaction) => {
        const commentRecords = await transaction.getAll<LegacyCommunityComment>('comments');
        const comments = commentRecords
          .map((record) => normalizeComment(record))
          .filter(Boolean) as CommunityComment[];
        const target = comments.find((comment) => comment.id === commentId);
        if (!target) {
          return false;
        }

        const removableIds = collectDescendantCommentIds(comments, commentId);

        for (const id of removableIds) {
          await transaction.delete('comments', id);
        }

        const likeRecords = await transaction.getAll<Partial<CommunityLike>>('likes');
        const likes = likeRecords.map((record) => normalizeLike(record)).filter(Boolean) as CommunityLike[];
        for (const like of likes) {
          if (like.commentId && removableIds.has(like.commentId)) {
            await transaction.delete('likes', like.id);
          }
        }

        const reportRecords = await transaction.getAll<Partial<CommunityReport>>('reports');
        const reports = reportRecords
          .map((record) => normalizeReport(record))
          .filter(Boolean) as CommunityReport[];
        for (const report of reports) {
          if (report.targetType === 'comment' && removableIds.has(report.targetId)) {
            await transaction.delete('reports', report.id);
          }
        }

        const postRecord = await transaction.get<LegacyCommunityPost>('posts', target.postId);
        const post = normalizePost(postRecord);
        if (post?.acceptedAnswerId && removableIds.has(post.acceptedAnswerId)) {
          await transaction.put('posts', {
            ...post,
            acceptedAnswerId: undefined
          });
        }

        return true;
      }
    );
  }

  async toggleLike(
    userId: string,
    targetType: CommunityLikeTargetType,
    targetId: string,
    createdAt: number
  ): Promise<CommunityToggleLikeResult> {
    return indexedDbClient.withTransaction(
      ['likes', 'posts', 'comments'],
      'readwrite',
      async (transaction) => {
        const likeRecords = await transaction.getAll<Partial<CommunityLike>>('likes');
        const likes = likeRecords.map((record) => normalizeLike(record)).filter(Boolean) as CommunityLike[];

        const existingLike = likes.find((like) => {
          return like.userId === userId && isLikeTargetMatch(like, targetType, targetId);
        });

        if (existingLike) {
          await transaction.delete('likes', existingLike.id);

          if (targetType === 'post') {
            const postRecord = await transaction.get<LegacyCommunityPost>('posts', targetId);
            const post = normalizePost(postRecord);
            if (!post) {
              throw new Error('POST_NOT_FOUND');
            }

            const nextPost = {
              ...post,
              likeCount: Math.max(0, post.likeCount - 1)
            };
            await transaction.put('posts', nextPost);
            return {
              liked: false,
              likeCount: nextPost.likeCount,
              like: null
            };
          }

          const commentRecord = await transaction.get<LegacyCommunityComment>('comments', targetId);
          const comment = normalizeComment(commentRecord);
          if (!comment) {
            throw new Error('COMMENT_NOT_FOUND');
          }

          const nextComment = {
            ...comment,
            likeCount: Math.max(0, comment.likeCount - 1)
          };
          await transaction.put('comments', nextComment);

          return {
            liked: false,
            likeCount: nextComment.likeCount,
            like: null
          };
        }

        const like: CommunityLike = {
          id: createId('community-like'),
          userId,
          postId: targetType === 'post' ? targetId : undefined,
          commentId: targetType === 'comment' ? targetId : undefined,
          createdAt
        };

        if (targetType === 'post') {
          const postRecord = await transaction.get<LegacyCommunityPost>('posts', targetId);
          const post = normalizePost(postRecord);
          if (!post) {
            throw new Error('POST_NOT_FOUND');
          }

          const nextPost = {
            ...post,
            likeCount: post.likeCount + 1
          };

          await transaction.put('likes', like);
          await transaction.put('posts', nextPost);

          return {
            liked: true,
            likeCount: nextPost.likeCount,
            like
          };
        }

        const commentRecord = await transaction.get<LegacyCommunityComment>('comments', targetId);
        const comment = normalizeComment(commentRecord);
        if (!comment) {
          throw new Error('COMMENT_NOT_FOUND');
        }

        const nextComment = {
          ...comment,
          likeCount: comment.likeCount + 1
        };

        await transaction.put('likes', like);
        await transaction.put('comments', nextComment);

        return {
          liked: true,
          likeCount: nextComment.likeCount,
          like
        };
      }
    );
  }

  async getLikesForPost(postId: string): Promise<CommunityLike[]> {
    return indexedDbClient.withTransaction(['likes'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityLike>>('likes');
      const likes = records
        .map((record) => normalizeLike(record))
        .filter((like): like is CommunityLike => Boolean(like && like.postId === postId));
      return sortByNewest(likes);
    });
  }

  async getLikesForComment(commentId: string): Promise<CommunityLike[]> {
    return indexedDbClient.withTransaction(['likes'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityLike>>('likes');
      const likes = records
        .map((record) => normalizeLike(record))
        .filter((like): like is CommunityLike => Boolean(like && like.commentId === commentId));
      return sortByNewest(likes);
    });
  }

  async getAllLikes(): Promise<CommunityLike[]> {
    return indexedDbClient.withTransaction(['likes'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityLike>>('likes');
      const likes = records.map((record) => normalizeLike(record)).filter(Boolean) as CommunityLike[];
      return sortByNewest(likes);
    });
  }

  async toggleFavorite(
    userId: string,
    postId: string,
    createdAt: number
  ): Promise<CommunityToggleFavoriteResult> {
    return indexedDbClient.withTransaction(
      ['favorites', 'posts'],
      'readwrite',
      async (transaction) => {
        const postRecord = await transaction.get<LegacyCommunityPost>('posts', postId);
        const post = normalizePost(postRecord);
        if (!post) {
          throw new Error('POST_NOT_FOUND');
        }

        const favoriteRecords = await transaction.getAll<Partial<CommunityFavorite>>('favorites');
        const favorites = favoriteRecords
          .map((record) => normalizeFavorite(record))
          .filter(Boolean) as CommunityFavorite[];

        const existingFavorite = favorites.find(
          (favorite) => favorite.userId === userId && favorite.postId === postId
        );

        if (existingFavorite) {
          await transaction.delete('favorites', existingFavorite.id);
          const nextPost = {
            ...post,
            favoriteCount: Math.max(0, post.favoriteCount - 1)
          };
          await transaction.put('posts', nextPost);

          return {
            saved: false,
            favoriteCount: nextPost.favoriteCount,
            favorite: null
          };
        }

        const favorite: CommunityFavorite = {
          id: createId('community-favorite'),
          userId,
          postId,
          createdAt
        };

        await transaction.put('favorites', favorite);

        const nextPost = {
          ...post,
          favoriteCount: post.favoriteCount + 1
        };
        await transaction.put('posts', nextPost);

        return {
          saved: true,
          favoriteCount: nextPost.favoriteCount,
          favorite
        };
      }
    );
  }

  async getFavoritesByUser(userId: string): Promise<CommunityFavorite[]> {
    return indexedDbClient.withTransaction(['favorites'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityFavorite>>('favorites');
      const favorites = records
        .map((record) => normalizeFavorite(record))
        .filter((favorite): favorite is CommunityFavorite => Boolean(favorite && favorite.userId === userId));
      return sortByNewest(favorites);
    });
  }

  async getFavoritesForPost(postId: string): Promise<CommunityFavorite[]> {
    return indexedDbClient.withTransaction(['favorites'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityFavorite>>('favorites');
      const favorites = records
        .map((record) => normalizeFavorite(record))
        .filter((favorite): favorite is CommunityFavorite => Boolean(favorite && favorite.postId === postId));
      return sortByNewest(favorites);
    });
  }

  async getAllFavorites(): Promise<CommunityFavorite[]> {
    return indexedDbClient.withTransaction(['favorites'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityFavorite>>('favorites');
      const favorites = records
        .map((record) => normalizeFavorite(record))
        .filter(Boolean) as CommunityFavorite[];
      return sortByNewest(favorites);
    });
  }

  async toggleFollow(
    followerId: string,
    followingId: string,
    createdAt: number
  ): Promise<CommunityToggleFollowResult> {
    return indexedDbClient.withTransaction(['follows'], 'readwrite', async (transaction) => {
      if (followerId === followingId) {
        throw new Error('SELF_FOLLOW_NOT_ALLOWED');
      }

      const followRecords = await transaction.getAll<Partial<CommunityFollow>>('follows');
      const follows = followRecords
        .map((record) => normalizeFollow(record))
        .filter(Boolean) as CommunityFollow[];

      const existingFollow = follows.find(
        (follow) => follow.followerId === followerId && follow.followingId === followingId
      );

      if (existingFollow) {
        await transaction.delete('follows', existingFollow.id);
        return {
          following: false,
          follow: null
        };
      }

      const follow: CommunityFollow = {
        id: createId('community-follow'),
        followerId,
        followingId,
        createdAt
      };

      await transaction.put('follows', follow);

      return {
        following: true,
        follow
      };
    });
  }

  async getFollowingByUser(followerId: string): Promise<CommunityFollow[]> {
    return indexedDbClient.withTransaction(['follows'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityFollow>>('follows');
      const follows = records
        .map((record) => normalizeFollow(record))
        .filter((follow): follow is CommunityFollow => Boolean(follow && follow.followerId === followerId));
      return sortByNewest(follows);
    });
  }

  async getFollowersByUser(followingId: string): Promise<CommunityFollow[]> {
    return indexedDbClient.withTransaction(['follows'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityFollow>>('follows');
      const follows = records
        .map((record) => normalizeFollow(record))
        .filter((follow): follow is CommunityFollow => Boolean(follow && follow.followingId === followingId));
      return sortByNewest(follows);
    });
  }

  async getAllFollows(): Promise<CommunityFollow[]> {
    return indexedDbClient.withTransaction(['follows'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityFollow>>('follows');
      const follows = records.map((record) => normalizeFollow(record)).filter(Boolean) as CommunityFollow[];
      return sortByNewest(follows);
    });
  }

  async createReport(report: CommunityReport): Promise<boolean> {
    return indexedDbClient.withTransaction(['reports'], 'readwrite', async (transaction) => {
      const reportRecords = await transaction.getAll<Partial<CommunityReport>>('reports');
      const reports = reportRecords.map((record) => normalizeReport(record)).filter(Boolean) as CommunityReport[];

      const duplicate = reports.some((existingReport) => {
        return (
          existingReport.reporterId === report.reporterId &&
          existingReport.targetId === report.targetId &&
          existingReport.targetType === report.targetType
        );
      });

      if (duplicate) {
        return false;
      }

      await transaction.put('reports', report);
      return true;
    });
  }

  async getReportsByTarget(
    targetType: CommunityReportTargetType,
    targetId: string,
    status?: CommunityReport['status']
  ): Promise<CommunityReport[]> {
    return indexedDbClient.withTransaction(['reports'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityReport>>('reports');
      const reports = records
        .map((record) => normalizeReport(record))
        .filter(
          (report): report is CommunityReport =>
            Boolean(
              report &&
                report.targetType === targetType &&
                report.targetId === targetId &&
                (status ? report.status === status : true)
            )
        );
      return sortByNewest(reports);
    });
  }

  async getReportById(reportId: string): Promise<CommunityReport | null> {
    return indexedDbClient.withTransaction(['reports'], 'readonly', async (transaction) => {
      const record = await transaction.get<Partial<CommunityReport>>('reports', reportId);
      return normalizeReport(record);
    });
  }

  async getAllReports(status?: CommunityReport['status']): Promise<CommunityReport[]> {
    return indexedDbClient.withTransaction(['reports'], 'readonly', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityReport>>('reports');
      const reports = records
        .map((record) => normalizeReport(record))
        .filter(
          (report): report is CommunityReport =>
            Boolean(report && (status ? report.status === status : true))
        );
      return sortByNewest(reports);
    });
  }

  async resolveReport(reportId: string): Promise<CommunityReport | null> {
    return indexedDbClient.withTransaction(['reports'], 'readwrite', async (transaction) => {
      const record = await transaction.get<Partial<CommunityReport>>('reports', reportId);
      const report = normalizeReport(record);
      if (!report) {
        return null;
      }

      if (report.status === 'resolved') {
        return report;
      }

      const updated: CommunityReport = {
        ...report,
        status: 'resolved'
      };
      await transaction.put('reports', updated);
      return updated;
    });
  }

  async markReportsResolved(targetType: CommunityReportTargetType, targetId: string): Promise<number> {
    return indexedDbClient.withTransaction(['reports'], 'readwrite', async (transaction) => {
      const records = await transaction.getAll<Partial<CommunityReport>>('reports');
      const reports = records.map((record) => normalizeReport(record)).filter(Boolean) as CommunityReport[];

      let updatedCount = 0;
      for (const report of reports) {
        if (report.targetType !== targetType || report.targetId !== targetId || report.status !== 'open') {
          continue;
        }

        await transaction.put('reports', {
          ...report,
          status: 'resolved'
        });
        updatedCount += 1;
      }

      return updatedCount;
    });
  }
}

export function createCommunityRepository(): CommunityRepository {
  return new IndexedDbCommunityRepository();
}
