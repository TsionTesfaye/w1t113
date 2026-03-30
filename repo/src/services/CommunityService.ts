import type {
  AuthenticatedUser,
  CommunityComment,
  CommunityPost,
  CommunityReport,
  UserRole
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
import type { SearchService } from '@/services/SearchService';
import { nowMs } from '@/services/timeSource';

const POST_RATE_LIMIT_PER_HOUR = 10;
const COMMENT_RATE_LIMIT_PER_HOUR = 30;
const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_REPLY_DEPTH = 3;
const MAX_CONTENT_LENGTH = 2000;
const MAX_REPORT_REASON_LENGTH = 240;
const MENTION_REGEX = /(^|\s)@([a-z0-9._-]{2,32})/gi;

export type CommunityFeedMode = 'feed' | 'following' | 'saved' | 'reported';

export type CommunityServiceErrorCode =
  | 'INVALID_CONTENT'
  | 'INVALID_POST_TYPE'
  | 'INVALID_REPORT_REASON'
  | 'FORBIDDEN'
  | 'POST_NOT_FOUND'
  | 'COMMENT_NOT_FOUND'
  | 'RATE_LIMIT_EXCEEDED'
  | 'REPLY_DEPTH_EXCEEDED'
  | 'USER_NOT_FOUND'
  | 'DUPLICATE_REPORT'
  | 'REPORT_NOT_FOUND'
  | 'SELF_FOLLOW_NOT_ALLOWED'
  | 'BLOCKED_INTERACTION'
  | 'INVALID_ANSWER_TARGET';

export class CommunityServiceError extends Error {
  readonly code: CommunityServiceErrorCode;

  constructor(code: CommunityServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CommunityFeedItem {
  post: CommunityPost;
  authorDisplayName: string;
  commentCount: number;
  likedByViewer: boolean;
  favoritedByViewer: boolean;
  authorFollowedByViewer: boolean;
  reportCount: number;
}

export interface CommunityThreadComment {
  comment: CommunityComment;
  authorDisplayName: string;
  depth: number;
  likedByViewer: boolean;
  reportCount: number;
  isAcceptedAnswer: boolean;
}

export interface CommunityPostThread {
  feedItem: CommunityFeedItem;
  comments: CommunityThreadComment[];
}

export interface ModerationReportItem {
  report: CommunityReport;
  reporterDisplayName: string;
  targetContentPreview: string;
  relatedPostId: string | null;
  targetDeleted: boolean;
}

export interface CommunityService {
  createPost(
    userId: string,
    role: UserRole,
    content: string,
    postType?: 'post' | 'question'
  ): Promise<CommunityPost>;
  createComment(
    userId: string,
    role: UserRole,
    postId: string,
    parentId: string | null,
    content: string
  ): Promise<CommunityComment>;
  toggleLike(
    userId: string,
    targetType: CommunityLikeTargetType,
    targetId: string
  ): Promise<CommunityToggleLikeResult>;
  toggleFavorite(userId: string, postId: string): Promise<CommunityToggleFavoriteResult>;
  toggleFollow(userId: string, targetUserId: string): Promise<CommunityToggleFollowResult>;
  reportContent(
    userId: string,
    role: UserRole,
    targetType: CommunityReportTargetType,
    targetId: string,
    reason: string
  ): Promise<CommunityReport>;
  markReportsResolved(
    actorUserId: string,
    actorRole: UserRole,
    targetType: CommunityReportTargetType,
    targetId: string
  ): Promise<number>;
  getOpenReports(actorUserId: string, actorRole: UserRole): Promise<ModerationReportItem[]>;
  resolveReport(actorUserId: string, actorRole: UserRole, reportId: string): Promise<CommunityReport>;
  markAnswerAccepted(
    actorUserId: string,
    actorRole: UserRole,
    postId: string,
    commentId: string
  ): Promise<CommunityPost>;
  deletePost(actorUserId: string, actorRole: UserRole, postId: string): Promise<void>;
  deleteComment(actorUserId: string, actorRole: UserRole, commentId: string): Promise<void>;
  getFeed(viewerUserId: string): Promise<CommunityFeedItem[]>;
  getFollowingFeed(viewerUserId: string): Promise<CommunityFeedItem[]>;
  getSavedPosts(viewerUserId: string): Promise<CommunityFeedItem[]>;
  getReportedContent(viewerUserId: string): Promise<CommunityFeedItem[]>;
  getPostThread(postId: string, viewerUserId: string): Promise<CommunityPostThread>;
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function sanitizeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toDisplayName(role: UserRole, username: string | undefined): string {
  if (role === 'admin') {
    return 'Studio';
  }

  if (role === 'moderator') {
    return 'Moderator';
  }

  if (role === 'photographer') {
    return 'Photographer';
  }

  return username?.trim() || 'Client';
}

function ensureValidContent(content: string, entityLabel: 'post' | 'comment'): string {
  const normalized = sanitizeText(content);
  if (!normalized) {
    throw new CommunityServiceError('INVALID_CONTENT', `${entityLabel} content cannot be empty.`);
  }

  if (normalized.length > MAX_CONTENT_LENGTH) {
    throw new CommunityServiceError(
      'INVALID_CONTENT',
      `${entityLabel} content cannot exceed ${MAX_CONTENT_LENGTH} characters.`
    );
  }

  return normalized;
}

function ensureValidReportReason(reason: string): string {
  const normalized = sanitizeText(reason);
  if (!normalized) {
    throw new CommunityServiceError('INVALID_REPORT_REASON', 'Please provide a report reason.');
  }

  if (normalized.length > MAX_REPORT_REASON_LENGTH) {
    throw new CommunityServiceError(
      'INVALID_REPORT_REASON',
      `Report reason cannot exceed ${MAX_REPORT_REASON_LENGTH} characters.`
    );
  }

  return normalized;
}

function extractMentions(content: string): string[] {
  const usernames = new Set<string>();
  MENTION_REGEX.lastIndex = 0;

  let match = MENTION_REGEX.exec(content);
  while (match) {
    const username = (match[2] ?? '').trim().toLowerCase();
    if (username) {
      usernames.add(username);
    }

    match = MENTION_REGEX.exec(content);
  }

  return [...usernames];
}

function sortCommentsByThread(comments: CommunityComment[]): Array<{ comment: CommunityComment; depth: number }> {
  const commentsByParent = new Map<string | null, CommunityComment[]>();

  for (const comment of comments) {
    const key = comment.parentId ?? null;
    const existing = commentsByParent.get(key);
    if (existing) {
      existing.push(comment);
      continue;
    }

    commentsByParent.set(key, [comment]);
  }

  for (const children of commentsByParent.values()) {
    children.sort((left, right) => left.createdAt - right.createdAt);
  }

  const ordered: Array<{ comment: CommunityComment; depth: number }> = [];

  const traverse = (parentId: string | null, depth: number): void => {
    const children = commentsByParent.get(parentId) ?? [];
    for (const child of children) {
      ordered.push({ comment: child, depth });
      traverse(child.id, depth + 1);
    }
  };

  traverse(null, 0);
  return ordered;
}

function findCommentDepth(commentMap: Map<string, CommunityComment>, parentId: string | null): number {
  let depth = 0;
  let cursor = parentId;
  const visited = new Set<string>();

  while (cursor) {
    if (visited.has(cursor)) {
      break;
    }

    visited.add(cursor);
    const current = commentMap.get(cursor);
    if (!current) {
      break;
    }

    depth += 1;
    cursor = current.parentId;
  }

  return depth;
}

function isModeratorRole(role: UserRole): boolean {
  return role === 'admin' || role === 'moderator';
}

function isAnswerManagerRole(role: UserRole): boolean {
  return role === 'admin' || role === 'photographer';
}

function isInteractionBlocked(
  actor: Pick<AuthenticatedUser, 'id' | 'blockedUserIds'>,
  target: Pick<AuthenticatedUser, 'id' | 'blockedUserIds'>
): boolean {
  if (actor.id === target.id) {
    return false;
  }

  const actorBlocked = Array.isArray(actor.blockedUserIds) ? actor.blockedUserIds : [];
  const targetBlocked = Array.isArray(target.blockedUserIds) ? target.blockedUserIds : [];

  return (
    actorBlocked.includes(target.id) || targetBlocked.includes(actor.id)
  );
}

function isHiddenForViewer(
  viewerUserId: string,
  authorUserId: string,
  usersById: Map<string, AuthenticatedUser>
): boolean {
  if (viewerUserId === authorUserId) {
    return false;
  }

  const viewer = usersById.get(viewerUserId);
  const author = usersById.get(authorUserId);
  if (!viewer || !author) {
    return false;
  }

  return isInteractionBlocked(viewer, author);
}

class LocalCommunityService implements CommunityService {
  private readonly communityRepository: CommunityRepository;
  private readonly authRepository: AuthRepository;
  private readonly notificationService: NotificationService;
  private readonly searchService: SearchService | null;

  constructor(
    communityRepository: CommunityRepository,
    authRepository: AuthRepository,
    notificationService: NotificationService,
    searchService: SearchService | null = null
  ) {
    this.communityRepository = communityRepository;
    this.authRepository = authRepository;
    this.notificationService = notificationService;
    this.searchService = searchService;
  }

  async createPost(
    userId: string,
    role: UserRole,
    content: string,
    postType: 'post' | 'question' = 'post'
  ): Promise<CommunityPost> {
    const actor = await this.requireActor(userId, role);
    const normalizedContent = ensureValidContent(content, 'post');

    if (postType !== 'post' && postType !== 'question') {
      throw new CommunityServiceError('INVALID_POST_TYPE', 'Unsupported post type.');
    }

    const now = nowMs();
    const recentPosts = (await this.communityRepository.getPosts()).filter(
      (post) => post.authorId === actor.id && post.createdAt >= now - ONE_HOUR_MS
    );

    if (recentPosts.length >= POST_RATE_LIMIT_PER_HOUR) {
      throw new CommunityServiceError(
        'RATE_LIMIT_EXCEEDED',
        'Post limit reached. You can create up to 10 posts per hour.'
      );
    }

    const post: CommunityPost = {
      id: createId('community-post'),
      authorId: actor.id,
      authorRole: actor.role,
      type: postType,
      content: normalizedContent,
      createdAt: now,
      likeCount: 0,
      favoriteCount: 0,
      acceptedAnswerId: undefined
    };

    await this.communityRepository.createPost(post);
    await this.searchService?.indexPost(post);

    await this.notifyMentions(normalizedContent, actor.id, {
      postId: post.id,
      commentId: null,
      sourceType: 'post'
    });

    return post;
  }

  async createComment(
    userId: string,
    role: UserRole,
    postId: string,
    parentId: string | null,
    content: string
  ): Promise<CommunityComment> {
    const actor = await this.requireActor(userId, role);
    const normalizedContent = ensureValidContent(content, 'comment');

    const post = await this.communityRepository.getPostById(postId);
    if (!post) {
      throw new CommunityServiceError('POST_NOT_FOUND', 'Post not found.');
    }

    await this.ensureInteractionAllowed(actor.id, post.authorId);

    const now = nowMs();
    const recentComments = (await this.communityRepository.getAllComments()).filter(
      (comment) => comment.authorId === actor.id && comment.createdAt >= now - ONE_HOUR_MS
    );

    if (recentComments.length >= COMMENT_RATE_LIMIT_PER_HOUR) {
      throw new CommunityServiceError(
        'RATE_LIMIT_EXCEEDED',
        'Comment limit reached. You can create up to 30 comments per hour.'
      );
    }

    const commentsForPost = await this.communityRepository.getComments(postId);
    const commentsById = new Map(commentsForPost.map((comment) => [comment.id, comment]));

    let replyTargetAuthorId: string | null = post.authorId;
    if (parentId) {
      const parentComment = commentsById.get(parentId);
      if (!parentComment) {
        throw new CommunityServiceError('COMMENT_NOT_FOUND', 'Parent comment was not found.');
      }

      await this.ensureInteractionAllowed(actor.id, parentComment.authorId);

      const parentDepth = findCommentDepth(commentsById, parentComment.parentId);
      if (parentDepth + 1 > MAX_REPLY_DEPTH) {
        throw new CommunityServiceError(
          'REPLY_DEPTH_EXCEEDED',
          'Maximum reply depth reached for this thread.'
        );
      }

      replyTargetAuthorId = parentComment.authorId;
    }

    const comment: CommunityComment = {
      id: createId('community-comment'),
      postId,
      authorId: actor.id,
      authorRole: actor.role,
      parentId,
      content: normalizedContent,
      createdAt: now,
      likeCount: 0
    };

    await this.communityRepository.createComment(comment);

    if (replyTargetAuthorId && replyTargetAuthorId !== actor.id) {
      await this.notificationService.createNotification(
        replyTargetAuthorId,
        'community_reply',
        'New reply in the community feed',
        {
          postId,
          commentId: comment.id,
          parentId,
          actorId: actor.id
        },
        `community-reply-${comment.id}-${replyTargetAuthorId}`
      );
    }

    await this.notifyMentions(normalizedContent, actor.id, {
      postId,
      commentId: comment.id,
      sourceType: 'comment'
    });

    return comment;
  }

  async toggleLike(
    userId: string,
    targetType: CommunityLikeTargetType,
    targetId: string
  ): Promise<CommunityToggleLikeResult> {
    const actor = await this.requireActor(userId, null);
    const targetAuthorId = await this.resolveTargetAuthorId(targetType, targetId);
    if (targetAuthorId) {
      await this.ensureInteractionAllowed(actor.id, targetAuthorId);
    }
    const result = await this.communityRepository.toggleLike(userId, targetType, targetId, nowMs());

    if (!result.liked) {
      return result;
    }

    if (targetAuthorId && targetAuthorId !== actor.id) {
      await this.notificationService.createNotification(
        targetAuthorId,
        'community_like',
        'Someone liked your community activity',
        {
          targetType,
          targetId,
          actorId: actor.id
        },
        `community-like-${result.like?.id ?? targetId}-${targetAuthorId}`
      );
    }

    return result;
  }

  async toggleFavorite(userId: string, postId: string): Promise<CommunityToggleFavoriteResult> {
    const actor = await this.requireActor(userId, null);
    const post = await this.communityRepository.getPostById(postId);
    if (!post) {
      throw new CommunityServiceError('POST_NOT_FOUND', 'Post not found.');
    }

    await this.ensureInteractionAllowed(actor.id, post.authorId);
    const result = await this.communityRepository.toggleFavorite(userId, postId, nowMs());

    if (!result.saved) {
      return result;
    }

    if (post.authorId !== actor.id) {
      await this.notificationService.createNotification(
        post.authorId,
        'community_favorite',
        'Someone saved your post',
        {
          postId,
          actorId: actor.id
        },
        `community-favorite-${result.favorite?.id ?? postId}-${post.authorId}`
      );
    }

    return result;
  }

  async toggleFollow(userId: string, targetUserId: string): Promise<CommunityToggleFollowResult> {
    const actor = await this.requireActor(userId, null);

    if (actor.id === targetUserId) {
      throw new CommunityServiceError('SELF_FOLLOW_NOT_ALLOWED', 'You cannot follow yourself.');
    }

    const targetUser = await this.authRepository.findUserById(targetUserId);
    if (!targetUser || !targetUser.isActive) {
      throw new CommunityServiceError('USER_NOT_FOUND', 'User not found.');
    }

    await this.ensureInteractionAllowed(actor.id, targetUser.id);

    const result = await this.communityRepository.toggleFollow(actor.id, targetUser.id, nowMs());

    if (result.following && targetUser.id !== actor.id) {
      await this.notificationService.createNotification(
        targetUser.id,
        'community_follow',
        'You have a new follower',
        {
          followerId: actor.id,
          actorId: actor.id
        },
        `community-follow-${result.follow?.id ?? `${actor.id}-${targetUser.id}`}`
      );
    }

    return result;
  }

  async reportContent(
    userId: string,
    role: UserRole,
    targetType: CommunityReportTargetType,
    targetId: string,
    reason: string
  ): Promise<CommunityReport> {
    const actor = await this.requireActor(userId, role);
    const normalizedReason = ensureValidReportReason(reason);

    if (targetType === 'post') {
      const post = await this.communityRepository.getPostById(targetId);
      if (!post) {
        throw new CommunityServiceError('POST_NOT_FOUND', 'Post not found.');
      }

      await this.ensureInteractionAllowed(actor.id, post.authorId);
    } else {
      const comment = await this.communityRepository.getCommentById(targetId);
      if (!comment) {
        throw new CommunityServiceError('COMMENT_NOT_FOUND', 'Comment not found.');
      }

      await this.ensureInteractionAllowed(actor.id, comment.authorId);
    }

    const report: CommunityReport = {
      id: createId('community-report'),
      reporterId: actor.id,
      targetId,
      targetType,
      reason: normalizedReason,
      createdAt: nowMs(),
      status: 'open'
    };

    const created = await this.communityRepository.createReport(report);
    if (!created) {
      throw new CommunityServiceError('DUPLICATE_REPORT', 'You have already reported this content.');
    }

    return report;
  }

  async markReportsResolved(
    actorUserId: string,
    actorRole: UserRole,
    targetType: CommunityReportTargetType,
    targetId: string
  ): Promise<number> {
    const actor = await this.requireModerator(actorUserId, actorRole);
    const openReports = await this.communityRepository.getReportsByTarget(targetType, targetId, 'open');
    const updatedCount = await this.communityRepository.markReportsResolved(targetType, targetId);

    if (updatedCount === 0) {
      return 0;
    }

    const reporterIds = new Set(openReports.map((report) => report.reporterId));
    await Promise.all(
      [...reporterIds].map(async (reporterId) => {
        if (reporterId === actor.id) {
          return;
        }

        await this.notificationService.createNotification(
          reporterId,
          'community_report_resolved',
          'Your report has been resolved',
          {
            targetType,
            targetId,
            resolverId: actor.id,
            actorId: actor.id
          },
          `community-report-resolved-${targetType}-${targetId}-${reporterId}`
        );
      })
    );

    return updatedCount;
  }

  async getOpenReports(actorUserId: string, actorRole: UserRole): Promise<ModerationReportItem[]> {
    await this.requireModerator(actorUserId, actorRole);

    const [openReports, posts, comments, users] = await Promise.all([
      this.communityRepository.getAllReports('open'),
      this.communityRepository.getPosts(),
      this.communityRepository.getAllComments(),
      this.authRepository.getAllUsers()
    ]);

    const postsById = new Map(posts.map((post) => [post.id, post]));
    const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
    const usersById = new Map(users.map((user) => [user.id, user]));

    return openReports
      .map((report) => {
        const reporter = usersById.get(report.reporterId);
        if (report.targetType === 'post') {
          const post = postsById.get(report.targetId);
          return {
            report,
            reporterDisplayName: reporter?.username ?? 'Unknown user',
            targetContentPreview: post?.content ?? '[Content removed]',
            relatedPostId: post?.id ?? null,
            targetDeleted: !post
          };
        }

        const comment = commentsById.get(report.targetId);
        return {
          report,
          reporterDisplayName: reporter?.username ?? 'Unknown user',
          targetContentPreview: comment?.content ?? '[Content removed]',
          relatedPostId: comment?.postId ?? null,
          targetDeleted: !comment
        };
      })
      .sort((left, right) => right.report.createdAt - left.report.createdAt);
  }

  async resolveReport(
    actorUserId: string,
    actorRole: UserRole,
    reportId: string
  ): Promise<CommunityReport> {
    const actor = await this.requireModerator(actorUserId, actorRole);
    const updated = await this.communityRepository.resolveReport(reportId);
    if (!updated) {
      throw new CommunityServiceError('REPORT_NOT_FOUND', 'Report not found.');
    }

    if (updated.reporterId !== actor.id) {
      await this.notificationService.createNotification(
        updated.reporterId,
        'community_report_resolved',
        'Your report has been resolved',
        {
          targetType: updated.targetType,
          targetId: updated.targetId,
          resolverId: actor.id,
          actorId: actor.id
        },
        `community-report-resolved-${updated.id}-${updated.reporterId}`
      );
    }

    return updated;
  }

  async markAnswerAccepted(
    actorUserId: string,
    actorRole: UserRole,
    postId: string,
    commentId: string
  ): Promise<CommunityPost> {
    const actor = await this.requireActor(actorUserId, actorRole);

    const post = await this.communityRepository.getPostById(postId);
    if (!post) {
      throw new CommunityServiceError('POST_NOT_FOUND', 'Post not found.');
    }

    if (!(isAnswerManagerRole(actor.role) || post.authorId === actor.id)) {
      throw new CommunityServiceError(
        'FORBIDDEN',
        'Only the question author, admin, or photographer can accept answers.'
      );
    }

    if (post.type !== 'question') {
      throw new CommunityServiceError('INVALID_ANSWER_TARGET', 'Only question posts can accept answers.');
    }

    const comment = await this.communityRepository.getCommentById(commentId);
    if (!comment || comment.postId !== post.id) {
      throw new CommunityServiceError('COMMENT_NOT_FOUND', 'Answer comment not found for this question.');
    }

    const updatedPost: CommunityPost = {
      ...post,
      acceptedAnswerId: comment.id
    };

    await this.communityRepository.updatePost(updatedPost);
    await this.searchService?.indexPost(updatedPost);

    if (comment.authorId !== actor.id) {
      await this.notificationService.createNotification(
        comment.authorId,
        'community_answer_accepted',
        'Your answer was accepted',
        {
          postId: post.id,
          commentId: comment.id,
          actorId: actor.id
        },
        `community-answer-accepted-${post.id}-${comment.id}-${comment.authorId}`
      );
    }

    return updatedPost;
  }

  async deletePost(actorUserId: string, actorRole: UserRole, postId: string): Promise<void> {
    await this.requireModerator(actorUserId, actorRole);

    const deleted = await this.communityRepository.deletePost(postId);
    if (!deleted) {
      throw new CommunityServiceError('POST_NOT_FOUND', 'Post not found.');
    }

    await this.searchService?.removeIndexEntry('post', postId);
  }

  async deleteComment(actorUserId: string, actorRole: UserRole, commentId: string): Promise<void> {
    await this.requireModerator(actorUserId, actorRole);

    const deleted = await this.communityRepository.deleteComment(commentId);
    if (!deleted) {
      throw new CommunityServiceError('COMMENT_NOT_FOUND', 'Comment not found.');
    }
  }

  async getFeed(viewerUserId: string): Promise<CommunityFeedItem[]> {
    await this.requireActor(viewerUserId, null);
    return this.buildFeed(viewerUserId, 'feed');
  }

  async getFollowingFeed(viewerUserId: string): Promise<CommunityFeedItem[]> {
    await this.requireActor(viewerUserId, null);
    return this.buildFeed(viewerUserId, 'following');
  }

  async getSavedPosts(viewerUserId: string): Promise<CommunityFeedItem[]> {
    await this.requireActor(viewerUserId, null);
    return this.buildFeed(viewerUserId, 'saved');
  }

  async getReportedContent(viewerUserId: string): Promise<CommunityFeedItem[]> {
    const actor = await this.requireActor(viewerUserId, null);
    if (!isModeratorRole(actor.role)) {
      throw new CommunityServiceError('FORBIDDEN', 'Moderator access is required for reported content.');
    }

    return this.buildFeed(viewerUserId, 'reported');
  }

  async getPostThread(postId: string, viewerUserId: string): Promise<CommunityPostThread> {
    await this.requireActor(viewerUserId, null);

    const [post, comments, likes, favorites, follows, reports, users] = await Promise.all([
      this.communityRepository.getPostById(postId),
      this.communityRepository.getComments(postId),
      this.communityRepository.getAllLikes(),
      this.communityRepository.getAllFavorites(),
      this.communityRepository.getAllFollows(),
      this.communityRepository.getAllReports('open'),
      this.authRepository.getAllUsers()
    ]);

    if (!post) {
      throw new CommunityServiceError('POST_NOT_FOUND', 'Post not found.');
    }

    const usersById = new Map(users.map((user) => [user.id, user]));

    if (isHiddenForViewer(viewerUserId, post.authorId, usersById)) {
      throw new CommunityServiceError('POST_NOT_FOUND', 'Post not found.');
    }

    const likedCommentIds = new Set(
      likes
        .filter((like) => like.userId === viewerUserId && typeof like.commentId === 'string')
        .map((like) => like.commentId as string)
    );

    const favoritedPostIds = new Set(
      favorites
        .filter((favorite) => favorite.userId === viewerUserId)
        .map((favorite) => favorite.postId)
    );

    const followedAuthorIds = new Set(
      follows
        .filter((follow) => follow.followerId === viewerUserId)
        .map((follow) => follow.followingId)
    );

    const reportCountByCommentId = new Map<string, number>();
    let reportCountForPost = 0;

    for (const report of reports) {
      if (report.targetType === 'post' && report.targetId === post.id) {
        reportCountForPost += 1;
      }

      if (report.targetType === 'comment') {
        reportCountByCommentId.set(
          report.targetId,
          (reportCountByCommentId.get(report.targetId) ?? 0) + 1
        );
      }
    }

    const visibleComments = comments.filter(
      (comment) => !isHiddenForViewer(viewerUserId, comment.authorId, usersById)
    );
    const orderedComments = sortCommentsByThread(visibleComments);

    const feedItem: CommunityFeedItem = {
      post,
      authorDisplayName: toDisplayName(post.authorRole, usersById.get(post.authorId)?.username),
      commentCount: visibleComments.length,
      likedByViewer: Boolean(
        likes.find((like) => like.userId === viewerUserId && like.postId === post.id)
      ),
      favoritedByViewer: favoritedPostIds.has(post.id),
      authorFollowedByViewer: followedAuthorIds.has(post.authorId),
      reportCount: reportCountForPost
    };

    const threadComments: CommunityThreadComment[] = orderedComments.map(({ comment, depth }) => {
      const user = usersById.get(comment.authorId);

      return {
        comment,
        authorDisplayName: toDisplayName(comment.authorRole, user?.username),
        depth,
        likedByViewer: likedCommentIds.has(comment.id),
        reportCount: reportCountByCommentId.get(comment.id) ?? 0,
        isAcceptedAnswer: post.acceptedAnswerId === comment.id
      };
    });

    return {
      feedItem,
      comments: threadComments
    };
  }

  private async buildFeed(viewerUserId: string, mode: CommunityFeedMode): Promise<CommunityFeedItem[]> {
    const [posts, comments, likes, favorites, follows, reports, users] = await Promise.all([
      this.communityRepository.getPosts(),
      this.communityRepository.getAllComments(),
      this.communityRepository.getAllLikes(),
      this.communityRepository.getAllFavorites(),
      this.communityRepository.getAllFollows(),
      this.communityRepository.getAllReports('open'),
      this.authRepository.getAllUsers()
    ]);

    const usersById = new Map(users.map((user) => [user.id, user]));
    const visibleComments = comments.filter(
      (comment) => !isHiddenForViewer(viewerUserId, comment.authorId, usersById)
    );

    const commentCountByPostId = new Map<string, number>();
    for (const comment of visibleComments) {
      commentCountByPostId.set(comment.postId, (commentCountByPostId.get(comment.postId) ?? 0) + 1);
    }

    const commentIdsByPostId = new Map<string, Set<string>>();
    for (const comment of visibleComments) {
      const existing = commentIdsByPostId.get(comment.postId);
      if (existing) {
        existing.add(comment.id);
        continue;
      }

      commentIdsByPostId.set(comment.postId, new Set([comment.id]));
    }

    const reportCountByPostId = new Map<string, number>();
    for (const report of reports) {
      if (report.targetType === 'post') {
        reportCountByPostId.set(
          report.targetId,
          (reportCountByPostId.get(report.targetId) ?? 0) + 1
        );
        continue;
      }

      if (report.targetType === 'comment') {
        for (const [postId, commentIds] of commentIdsByPostId.entries()) {
          if (!commentIds.has(report.targetId)) {
            continue;
          }

          reportCountByPostId.set(postId, (reportCountByPostId.get(postId) ?? 0) + 1);
        }
      }
    }

    const likedPostIds = new Set(
      likes
        .filter((like) => like.userId === viewerUserId && typeof like.postId === 'string')
        .map((like) => like.postId as string)
    );

    const favoritesByViewer = favorites
      .filter((favorite) => favorite.userId === viewerUserId)
      .sort((left, right) => right.createdAt - left.createdAt);
    const favoritePostIds = new Set(favoritesByViewer.map((favorite) => favorite.postId));
    const favoriteTimeByPostId = new Map(favoritesByViewer.map((favorite) => [favorite.postId, favorite.createdAt]));

    const followingSet = new Set(
      follows
        .filter((follow) => follow.followerId === viewerUserId)
        .map((follow) => follow.followingId)
    );

    let filteredPosts = [...posts].filter(
      (post) => !isHiddenForViewer(viewerUserId, post.authorId, usersById)
    );

    if (mode === 'following') {
      filteredPosts = filteredPosts.filter((post) => followingSet.has(post.authorId));
    }

    if (mode === 'saved') {
      filteredPosts = filteredPosts.filter((post) => favoritePostIds.has(post.id));
    }

    if (mode === 'reported') {
      filteredPosts = filteredPosts.filter((post) => (reportCountByPostId.get(post.id) ?? 0) > 0);
    }

    filteredPosts.sort((left, right) => {
      if (mode === 'saved') {
        const leftSavedAt = favoriteTimeByPostId.get(left.id) ?? 0;
        const rightSavedAt = favoriteTimeByPostId.get(right.id) ?? 0;
        return rightSavedAt - leftSavedAt;
      }

      if (mode === 'reported') {
        const leftCount = reportCountByPostId.get(left.id) ?? 0;
        const rightCount = reportCountByPostId.get(right.id) ?? 0;
        if (leftCount !== rightCount) {
          return rightCount - leftCount;
        }

        return right.createdAt - left.createdAt;
      }

      if (mode === 'feed') {
        const leftFollowed = followingSet.has(left.authorId);
        const rightFollowed = followingSet.has(right.authorId);

        if (leftFollowed !== rightFollowed) {
          return rightFollowed ? 1 : -1;
        }
      }

      return right.createdAt - left.createdAt;
    });

    return filteredPosts.map((post) => {
      const authorUser = usersById.get(post.authorId);

      return {
        post,
        authorDisplayName: toDisplayName(post.authorRole, authorUser?.username),
        commentCount: commentCountByPostId.get(post.id) ?? 0,
        likedByViewer: likedPostIds.has(post.id),
        favoritedByViewer: favoritePostIds.has(post.id),
        authorFollowedByViewer: followingSet.has(post.authorId),
        reportCount: reportCountByPostId.get(post.id) ?? 0
      };
    });
  }

  private async resolveTargetAuthorId(
    targetType: CommunityLikeTargetType,
    targetId: string
  ): Promise<string | null> {
    if (targetType === 'post') {
      const post = await this.communityRepository.getPostById(targetId);
      if (!post) {
        throw new CommunityServiceError('POST_NOT_FOUND', 'Post not found.');
      }

      return post.authorId;
    }

    const comment = await this.communityRepository.getCommentById(targetId);
    if (!comment) {
      throw new CommunityServiceError('COMMENT_NOT_FOUND', 'Comment not found.');
    }

    return comment.authorId;
  }

  private async notifyMentions(
    content: string,
    actorId: string,
    context: {
      postId: string;
      commentId: string | null;
      sourceType: 'post' | 'comment';
    }
  ): Promise<void> {
    const usernames = extractMentions(content);
    if (usernames.length === 0) {
      return;
    }

    const users = await this.authRepository.getAllUsers();
    const usersByUsername = new Map(users.map((user) => [user.username.toLowerCase(), user]));

    await Promise.all(
      usernames.map(async (username) => {
        const target = usersByUsername.get(username);
        if (!target || !target.isActive || target.id === actorId) {
          return;
        }

        await this.notificationService.createNotification(
          target.id,
          'community_mention',
          'You were mentioned in the community feed',
          {
            postId: context.postId,
            commentId: context.commentId,
            sourceType: context.sourceType,
            actorId
          },
          `community-mention-${context.sourceType}-${context.commentId ?? context.postId}-${target.id}`
        );
      })
    );
  }

  private async requireActor(userId: string, claimedRole: UserRole | null) {
    const actor = await this.authRepository.findUserById(userId);
    if (!actor || !actor.isActive) {
      throw new CommunityServiceError('USER_NOT_FOUND', 'User not found.');
    }

    if (claimedRole && actor.role !== claimedRole) {
      throw new CommunityServiceError('FORBIDDEN', 'Role mismatch for this action.');
    }

    return actor;
  }

  private async requireModerator(actorUserId: string, actorRole: UserRole) {
    const actor = await this.requireActor(actorUserId, actorRole);
    if (!isModeratorRole(actor.role)) {
      throw new CommunityServiceError('FORBIDDEN', 'Moderator access is required for this action.');
    }

    return actor;
  }

  private async ensureInteractionAllowed(actorUserId: string, targetUserId: string): Promise<void> {
    if (actorUserId === targetUserId) {
      return;
    }

    const [actor, target] = await Promise.all([
      this.authRepository.findUserById(actorUserId),
      this.authRepository.findUserById(targetUserId)
    ]);

    if (!actor || !target) {
      throw new CommunityServiceError('USER_NOT_FOUND', 'User not found.');
    }

    if (isInteractionBlocked(actor, target)) {
      throw new CommunityServiceError(
        'BLOCKED_INTERACTION',
        'This action is unavailable because one of these users is blocked.'
      );
    }
  }
}

export function createCommunityService(
  communityRepository: CommunityRepository,
  authRepository: AuthRepository,
  notificationService: NotificationService,
  searchService: SearchService | null = null
): CommunityService {
  return new LocalCommunityService(
    communityRepository,
    authRepository,
    notificationService,
    searchService
  );
}
