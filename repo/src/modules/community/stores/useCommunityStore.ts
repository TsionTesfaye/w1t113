import { getCommunityService } from '@/app/providers/communityProvider';
import { useAuthStore } from '@/app/stores/useAuthStore';
import type { CommunityPost, UserRole } from '@/app/types/domain';
import type {
  CommunityLikeTargetType,
  CommunityReportTargetType
} from '@/repositories/CommunityRepository';
import type {
  CommunityFeedItem,
  CommunityFeedMode,
  CommunityPostThread,
  ModerationReportItem
} from '@/services/CommunityService';
import { defineStore } from 'pinia';

interface CommunityState {
  feed: CommunityFeedItem[];
  moderationReports: ModerationReportItem[];
  activeFeedMode: CommunityFeedMode;
  threadsByPostId: Record<string, CommunityPostThread>;
  loadingThreadByPostId: Record<string, boolean>;
  isLoadingFeed: boolean;
  isSubmitting: boolean;
  errorMessage: string;
}

interface CurrentUserContext {
  userId: string;
  role: UserRole;
}

export const useCommunityStore = defineStore('community', {
  state: (): CommunityState => ({
    feed: [],
    moderationReports: [],
    activeFeedMode: 'feed',
    threadsByPostId: {},
    loadingThreadByPostId: {},
    isLoadingFeed: false,
    isSubmitting: false,
    errorMessage: ''
  }),

  getters: {
    threadByPostId: (state) => {
      return (postId: string): CommunityPostThread | null => state.threadsByPostId[postId] ?? null;
    }
  },

  actions: {
    clearState(): void {
      this.feed = [];
      this.moderationReports = [];
      this.activeFeedMode = 'feed';
      this.threadsByPostId = {};
      this.loadingThreadByPostId = {};
      this.errorMessage = '';
    },

    async initialize(force = false): Promise<void> {
      if (!force && this.feed.length > 0) {
        return;
      }

      await this.fetchFeedByMode(this.activeFeedMode);
    },

    async setFeedMode(mode: CommunityFeedMode): Promise<void> {
      if (this.activeFeedMode === mode) {
        return;
      }

      this.activeFeedMode = mode;
      if (mode === 'reported') {
        await Promise.all([this.fetchFeedByMode(mode), this.fetchModerationReports()]);
        return;
      }

      await this.fetchFeedByMode(mode);
    },

    async fetchFeed(): Promise<void> {
      await this.fetchFeedByMode(this.activeFeedMode);
    },

    async getFollowingFeed(): Promise<void> {
      this.activeFeedMode = 'following';
      await this.fetchFeedByMode('following');
    },

    async getSavedPosts(): Promise<void> {
      this.activeFeedMode = 'saved';
      await this.fetchFeedByMode('saved');
    },

    async getReportedContent(): Promise<void> {
      this.activeFeedMode = 'reported';
      await Promise.all([this.fetchFeedByMode('reported'), this.fetchModerationReports()]);
    },

    async fetchFeedByMode(mode: CommunityFeedMode): Promise<void> {
      const viewerId = this.resolveViewerId();
      if (!viewerId) {
        this.clearState();
        return;
      }

      this.isLoadingFeed = true;
      this.errorMessage = '';

      try {
        if (mode === 'following') {
          this.feed = await getCommunityService().getFollowingFeed(viewerId);
        } else if (mode === 'saved') {
          this.feed = await getCommunityService().getSavedPosts(viewerId);
        } else if (mode === 'reported') {
          this.feed = await getCommunityService().getReportedContent(viewerId);
        } else {
          this.feed = await getCommunityService().getFeed(viewerId);
        }

        if (mode !== 'reported') {
          this.moderationReports = [];
        }
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to load the community feed.';
      } finally {
        this.isLoadingFeed = false;
      }
    },

    async fetchModerationReports(): Promise<void> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';

      try {
        this.moderationReports = await getCommunityService().getOpenReports(
          currentUser.userId,
          currentUser.role
        );
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to load report details.';
      }
    },

    async ensureThread(postId: string, force = false): Promise<void> {
      const viewerId = this.resolveViewerId();
      if (!viewerId) {
        return;
      }

      if (!force && this.threadsByPostId[postId]) {
        return;
      }

      this.loadingThreadByPostId = {
        ...this.loadingThreadByPostId,
        [postId]: true
      };

      try {
        const thread = await getCommunityService().getPostThread(postId, viewerId);
        this.threadsByPostId = {
          ...this.threadsByPostId,
          [postId]: thread
        };
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to load post replies.';
      } finally {
        this.loadingThreadByPostId = {
          ...this.loadingThreadByPostId,
          [postId]: false
        };
      }
    },

    async createPost(content: string, postType: 'post' | 'question'): Promise<CommunityPost | null> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';
      this.isSubmitting = true;

      try {
        const post = await getCommunityService().createPost(
          currentUser.userId,
          currentUser.role,
          content,
          postType
        );
        await this.fetchFeedByMode(this.activeFeedMode);
        return post;
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to create your post.';
        throw error;
      } finally {
        this.isSubmitting = false;
      }
    },

    async createComment(postId: string, parentId: string | null, content: string): Promise<void> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';
      this.isSubmitting = true;

      try {
        await getCommunityService().createComment(
          currentUser.userId,
          currentUser.role,
          postId,
          parentId,
          content
        );

        await Promise.all([this.fetchFeedByMode(this.activeFeedMode), this.ensureThread(postId, true)]);
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to add your reply.';
        throw error;
      } finally {
        this.isSubmitting = false;
      }
    },

    async toggleLike(
      targetType: CommunityLikeTargetType,
      targetId: string,
      postIdForRefresh?: string
    ): Promise<void> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';

      try {
        await getCommunityService().toggleLike(currentUser.userId, targetType, targetId);
        await this.fetchFeedByMode(this.activeFeedMode);

        const postId = targetType === 'post' ? targetId : postIdForRefresh;
        if (postId && this.threadsByPostId[postId]) {
          await this.ensureThread(postId, true);
        }
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to update like.';
        throw error;
      }
    },

    async toggleFavorite(postId: string): Promise<void> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';

      try {
        await getCommunityService().toggleFavorite(currentUser.userId, postId);
        await this.fetchFeedByMode(this.activeFeedMode);

        if (this.threadsByPostId[postId]) {
          await this.ensureThread(postId, true);
        }
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to update saved state.';
        throw error;
      }
    },

    async toggleFollow(targetUserId: string): Promise<void> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';

      try {
        await getCommunityService().toggleFollow(currentUser.userId, targetUserId);
        await this.fetchFeedByMode(this.activeFeedMode);
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to update follow state.';
        throw error;
      }
    },

    async reportContent(
      targetType: CommunityReportTargetType,
      targetId: string,
      reason: string,
      postIdForRefresh?: string
    ): Promise<void> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';

      try {
        await getCommunityService().reportContent(
          currentUser.userId,
          currentUser.role,
          targetType,
          targetId,
          reason
        );

        await this.fetchFeedByMode(this.activeFeedMode);

        if (postIdForRefresh && this.threadsByPostId[postIdForRefresh]) {
          await this.ensureThread(postIdForRefresh, true);
        }

        if (this.activeFeedMode === 'reported') {
          await this.fetchModerationReports();
        }
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to report this content.';
        throw error;
      }
    },

    async markReportsResolved(
      targetType: CommunityReportTargetType,
      targetId: string,
      postIdForRefresh?: string
    ): Promise<void> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';

      try {
        await getCommunityService().markReportsResolved(
          currentUser.userId,
          currentUser.role,
          targetType,
          targetId
        );

        await this.fetchFeedByMode(this.activeFeedMode);

        if (postIdForRefresh && this.threadsByPostId[postIdForRefresh]) {
          await this.ensureThread(postIdForRefresh, true);
        }

        if (this.activeFeedMode === 'reported') {
          await this.fetchModerationReports();
        }
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to resolve report.';
        throw error;
      }
    },

    async resolveReport(reportId: string, postIdForRefresh?: string): Promise<void> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';

      try {
        await getCommunityService().resolveReport(currentUser.userId, currentUser.role, reportId);
        await this.fetchFeedByMode(this.activeFeedMode);
        await this.fetchModerationReports();

        if (postIdForRefresh && this.threadsByPostId[postIdForRefresh]) {
          await this.ensureThread(postIdForRefresh, true);
        }
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to resolve report.';
        throw error;
      }
    },

    async markAnswerAccepted(postId: string, commentId: string): Promise<void> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';

      try {
        await getCommunityService().markAnswerAccepted(
          currentUser.userId,
          currentUser.role,
          postId,
          commentId
        );
        await Promise.all([this.fetchFeedByMode(this.activeFeedMode), this.ensureThread(postId, true)]);
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to mark accepted answer.';
        throw error;
      }
    },

    async deletePost(postId: string): Promise<void> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';
      this.isSubmitting = true;

      try {
        await getCommunityService().deletePost(currentUser.userId, currentUser.role, postId);
        const nextThreads = { ...this.threadsByPostId };
        delete nextThreads[postId];
        this.threadsByPostId = nextThreads;
        await this.fetchFeedByMode(this.activeFeedMode);
        if (this.activeFeedMode === 'reported') {
          await this.fetchModerationReports();
        }
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to delete this post.';
        throw error;
      } finally {
        this.isSubmitting = false;
      }
    },

    async deleteComment(postId: string, commentId: string): Promise<void> {
      const currentUser = this.requireCurrentUser();
      this.errorMessage = '';
      this.isSubmitting = true;

      try {
        await getCommunityService().deleteComment(currentUser.userId, currentUser.role, commentId);
        await Promise.all([this.fetchFeedByMode(this.activeFeedMode), this.ensureThread(postId, true)]);
        if (this.activeFeedMode === 'reported') {
          await this.fetchModerationReports();
        }
      } catch (error: unknown) {
        this.errorMessage =
          error instanceof Error ? error.message : 'Unable to delete this comment.';
        throw error;
      } finally {
        this.isSubmitting = false;
      }
    },

    isThreadLoading(postId: string): boolean {
      return this.loadingThreadByPostId[postId] === true;
    },

    resolveViewerId(): string | null {
      return useAuthStore().currentUser?.id ?? null;
    },

    requireCurrentUser(): CurrentUserContext {
      const user = useAuthStore().currentUser;
      if (!user) {
        throw new Error('You must be logged in to use the community.');
      }

      return {
        userId: user.id,
        role: user.role
      };
    }
  }
});
