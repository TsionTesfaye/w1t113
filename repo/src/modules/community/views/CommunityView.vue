<script setup lang="ts">
import { useAuthStore } from '@/app/stores/useAuthStore';
import AppModal from '@/components/AppModal.vue';
import { useSearchStore } from '@/modules/search/stores/useSearchStore';
import type {
  CommunityFeedMode,
  CommunityThreadComment,
  ModerationReportItem
} from '@/services/CommunityService';
import { useCommunityStore } from '@/modules/community/stores/useCommunityStore';
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const authStore = useAuthStore();
const communityStore = useCommunityStore();
const searchStore = useSearchStore();
const route = useRoute();

const postDraft = ref('');
const postTypeDraft = ref<'post' | 'question'>('post');
const postSearchQuery = ref('');
const expandedPosts = ref<Record<string, boolean>>({});
const commentDraftByPostId = ref<Record<string, string>>({});
const replyParentByPostId = ref<Record<string, string | null>>({});
const replyLabelByPostId = ref<Record<string, string>>({});
let searchDebounceId: number | null = null;
let confirmActionHandler: (() => Promise<void>) | null = null;

const feed = computed(() => communityStore.feed);
const activeFeedMode = computed(() => communityStore.activeFeedMode);
const { moderationReports } = storeToRefs(communityStore);
const {
  results: searchResults,
  isLoading: isSearchLoading,
  errorMessage: searchErrorMessage
} = storeToRefs(searchStore);
const currentUserId = computed(() => authStore.currentUser?.id ?? null);
const currentUserRole = computed(() => authStore.currentUser?.role ?? null);
const hasPostSearchQuery = computed(() => postSearchQuery.value.trim().length > 0);
const matchedPostIds = computed(() => new Set(searchResults.value.map((result) => result.entityId)));
const searchResultByPostId = computed(
  () => new Map(searchResults.value.map((result) => [result.entityId, result]))
);
const visibleFeed = computed(() => {
  if (!hasPostSearchQuery.value) {
    return feed.value;
  }

  return feed.value.filter((item) => matchedPostIds.value.has(item.post.id));
});
const canModerate = computed(() => {
  return currentUserRole.value === 'admin' || currentUserRole.value === 'moderator';
});
const canAcceptAnswersByRole = computed(() => {
  return currentUserRole.value === 'admin' || currentUserRole.value === 'photographer';
});
const isReportedMode = computed(() => canModerate.value && activeFeedMode.value === 'reported');
const blockedUserIds = computed(() => new Set(authStore.currentUser?.blockedUserIds ?? []));

const showReportModal = ref(false);
const reportReasonDraft = ref('');
const reportReasonError = ref('');
const reportTargetType = ref<'post' | 'comment' | null>(null);
const reportTargetId = ref<string | null>(null);
const reportPostIdForRefresh = ref<string | null>(null);

const showConfirmModal = ref(false);
const confirmModalTitle = ref('');
const confirmModalMessage = ref('');
const confirmModalConfirmText = ref('Confirm');
const confirmModalVariant = ref<'primary' | 'danger'>('primary');

const feedTabs = computed<Array<{ mode: CommunityFeedMode; label: string }>>(() => {
  const tabs: Array<{ mode: CommunityFeedMode; label: string }> = [
    { mode: 'feed', label: 'Feed' },
    { mode: 'following', label: 'Following' },
    { mode: 'saved', label: 'Saved' }
  ];

  if (canModerate.value) {
    tabs.push({ mode: 'reported', label: 'Reported' });
  }

  return tabs;
});

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / (60 * 1000));

  if (diffMinutes < 1) {
    return 'just now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return new Date(timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric'
  });
}

function formatMetaLabel(authorDisplayName: string, createdAt: number): string {
  return `${authorDisplayName} · ${formatRelativeTime(createdAt)}`;
}

function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function isExpanded(postId: string): boolean {
  return expandedPosts.value[postId] === true;
}

function threadForPost(postId: string) {
  return communityStore.threadByPostId(postId);
}

function canFollowAuthor(authorId: string): boolean {
  return Boolean(currentUserId.value && currentUserId.value !== authorId);
}

function canBlockUser(targetUserId: string): boolean {
  return Boolean(currentUserId.value && currentUserId.value !== targetUserId);
}

function isUserBlocked(targetUserId: string): boolean {
  return blockedUserIds.value.has(targetUserId);
}

function canMarkAnswer(postType: 'post' | 'question', postAuthorId: string): boolean {
  if (postType !== 'question') {
    return false;
  }

  if (!currentUserId.value) {
    return false;
  }

  return canAcceptAnswersByRole.value || currentUserId.value === postAuthorId;
}

function openConfirmModal(options: {
  title: string;
  message: string;
  confirmText: string;
  variant?: 'primary' | 'danger';
  onConfirm: () => Promise<void>;
}): void {
  confirmModalTitle.value = options.title;
  confirmModalMessage.value = options.message;
  confirmModalConfirmText.value = options.confirmText;
  confirmModalVariant.value = options.variant ?? 'primary';
  confirmActionHandler = options.onConfirm;
  showConfirmModal.value = true;
}

function closeConfirmModal(): void {
  showConfirmModal.value = false;
  confirmActionHandler = null;
}

async function confirmModalAction(): Promise<void> {
  if (!confirmActionHandler) {
    closeConfirmModal();
    return;
  }

  try {
    await confirmActionHandler();
    closeConfirmModal();
  } catch {
    // Store already handles error state.
  }
}

function openReportModal(
  targetType: 'post' | 'comment',
  targetId: string,
  postIdForRefresh: string
): void {
  reportTargetType.value = targetType;
  reportTargetId.value = targetId;
  reportPostIdForRefresh.value = postIdForRefresh;
  reportReasonDraft.value = '';
  reportReasonError.value = '';
  showReportModal.value = true;
}

function closeReportModal(): void {
  showReportModal.value = false;
  reportReasonDraft.value = '';
  reportReasonError.value = '';
  reportTargetType.value = null;
  reportTargetId.value = null;
  reportPostIdForRefresh.value = null;
}

async function submitReportModal(): Promise<void> {
  const reason = reportReasonDraft.value.trim();
  if (!reason) {
    reportReasonError.value = 'Please provide a report reason.';
    return;
  }

  if (!reportTargetType.value || !reportTargetId.value || !reportPostIdForRefresh.value) {
    reportReasonError.value = 'Unable to submit this report right now.';
    return;
  }

  try {
    await communityStore.reportContent(
      reportTargetType.value,
      reportTargetId.value,
      reason,
      reportPostIdForRefresh.value
    );
    closeReportModal();
  } catch {
    // Store already handles error state.
  }
}

async function toggleReplies(postId: string): Promise<void> {
  const nextExpanded = !isExpanded(postId);
  expandedPosts.value = {
    ...expandedPosts.value,
    [postId]: nextExpanded
  };

  if (nextExpanded) {
    await communityStore.ensureThread(postId);
  }
}

async function changeFeedMode(mode: CommunityFeedMode): Promise<void> {
  if (mode === activeFeedMode.value) {
    return;
  }

  await communityStore.setFeedMode(mode);
}

async function submitPost(): Promise<void> {
  if (!postDraft.value.trim() || communityStore.isSubmitting) {
    return;
  }

  try {
    await communityStore.createPost(postDraft.value, postTypeDraft.value);
    postDraft.value = '';
    postTypeDraft.value = 'post';
  } catch {
    // Store already handles error state.
  }
}

function commentDraft(postId: string): string {
  return commentDraftByPostId.value[postId] ?? '';
}

function setCommentDraft(postId: string, value: string): void {
  commentDraftByPostId.value = {
    ...commentDraftByPostId.value,
    [postId]: value
  };
}

function setReplyTarget(postId: string, parentId: string | null, label: string): void {
  replyParentByPostId.value = {
    ...replyParentByPostId.value,
    [postId]: parentId
  };

  replyLabelByPostId.value = {
    ...replyLabelByPostId.value,
    [postId]: label
  };
}

function clearReplyTarget(postId: string): void {
  replyParentByPostId.value = {
    ...replyParentByPostId.value,
    [postId]: null
  };

  replyLabelByPostId.value = {
    ...replyLabelByPostId.value,
    [postId]: ''
  };
}

async function submitComment(postId: string): Promise<void> {
  const draft = commentDraft(postId);
  if (!draft.trim() || communityStore.isSubmitting) {
    return;
  }

  const parentId = replyParentByPostId.value[postId] ?? null;

  try {
    await communityStore.createComment(postId, parentId, draft);
    setCommentDraft(postId, '');
    clearReplyTarget(postId);
  } catch {
    // Store already handles error state.
  }
}

async function togglePostLike(postId: string): Promise<void> {
  try {
    await communityStore.toggleLike('post', postId, postId);
  } catch {
    // Store already handles error state.
  }
}

async function togglePostFavorite(postId: string): Promise<void> {
  try {
    await communityStore.toggleFavorite(postId);
  } catch {
    // Store already handles error state.
  }
}

async function toggleFollow(authorId: string): Promise<void> {
  if (!canFollowAuthor(authorId)) {
    return;
  }

  try {
    await communityStore.toggleFollow(authorId);
  } catch {
    // Store already handles error state.
  }
}

async function toggleUserBlock(targetUserId: string): Promise<void> {
  if (!canBlockUser(targetUserId)) {
    return;
  }

  try {
    if (isUserBlocked(targetUserId)) {
      await authStore.unblockUser(targetUserId);
    } else {
      await authStore.blockUser(targetUserId);
    }

    await communityStore.fetchFeedByMode(activeFeedMode.value);
  } catch {
    // Auth or store already handles error state.
  }
}

async function toggleCommentLike(postId: string, commentId: string): Promise<void> {
  try {
    await communityStore.toggleLike('comment', commentId, postId);
  } catch {
    // Store already handles error state.
  }
}

async function reportPost(postId: string): Promise<void> {
  openReportModal('post', postId, postId);
}

async function reportComment(postId: string, commentId: string): Promise<void> {
  openReportModal('comment', commentId, postId);
}

async function resolvePostReports(postId: string): Promise<void> {
  if (!canModerate.value) {
    return;
  }

  openConfirmModal({
    title: 'Resolve reports',
    message: 'Mark all reports for this post as resolved?',
    confirmText: 'Resolve',
    onConfirm: async () => {
      await communityStore.markReportsResolved('post', postId, postId);
    }
  });
}

async function resolveCommentReports(postId: string, commentId: string): Promise<void> {
  if (!canModerate.value) {
    return;
  }

  openConfirmModal({
    title: 'Resolve reports',
    message: 'Mark all reports for this comment as resolved?',
    confirmText: 'Resolve',
    onConfirm: async () => {
      await communityStore.markReportsResolved('comment', commentId, postId);
    }
  });
}

function reportTypeLabel(report: ModerationReportItem): string {
  return report.report.targetType === 'post' ? 'Post report' : 'Comment report';
}

async function resolveReport(report: ModerationReportItem): Promise<void> {
  if (!canModerate.value) {
    return;
  }

  openConfirmModal({
    title: 'Resolve report',
    message: 'Mark this report as resolved?',
    confirmText: 'Resolve',
    onConfirm: async () => {
      await communityStore.resolveReport(report.report.id, report.relatedPostId ?? undefined);
    }
  });
}

async function deleteReportedContent(report: ModerationReportItem): Promise<void> {
  if (!canModerate.value || report.targetDeleted) {
    return;
  }

  const targetLabel = report.report.targetType === 'post' ? 'post' : 'comment';
  openConfirmModal({
    title: `Delete reported ${targetLabel}`,
    message: `Delete this ${targetLabel} and resolve the report?`,
    confirmText: 'Delete',
    variant: 'danger',
    onConfirm: async () => {
      if (report.report.targetType === 'post') {
        await communityStore.deletePost(report.report.targetId);
      } else {
        const postId = report.relatedPostId;
        if (!postId) {
          throw new Error('Unable to locate this comment in the thread.');
        }

        await communityStore.deleteComment(postId, report.report.targetId);
      }

      await communityStore.resolveReport(report.report.id, report.relatedPostId ?? undefined);
    }
  });
}

async function markAcceptedAnswer(postId: string, commentId: string): Promise<void> {
  try {
    await communityStore.markAnswerAccepted(postId, commentId);
  } catch {
    // Store already handles error state.
  }
}

async function deletePost(postId: string): Promise<void> {
  if (!canModerate.value || communityStore.isSubmitting) {
    return;
  }

  openConfirmModal({
    title: 'Delete post',
    message: 'Delete this post and all of its replies?',
    confirmText: 'Delete post',
    variant: 'danger',
    onConfirm: async () => {
      await communityStore.deletePost(postId);
    }
  });
}

async function deleteComment(postId: string, commentId: string): Promise<void> {
  if (!canModerate.value || communityStore.isSubmitting) {
    return;
  }

  openConfirmModal({
    title: 'Delete comment',
    message: 'Delete this comment?',
    confirmText: 'Delete comment',
    variant: 'danger',
    onConfirm: async () => {
      await communityStore.deleteComment(postId, commentId);
    }
  });
}

function replyLabel(postId: string): string {
  return replyLabelByPostId.value[postId] ?? '';
}

function indentationStyle(comment: CommunityThreadComment): Record<string, string> {
  const depth = Math.max(0, Math.min(comment.depth, 3));
  return {
    marginLeft: `${depth * 16}px`
  };
}

function emptyTitle(): string {
  if (hasPostSearchQuery.value) {
    return 'No posts match your search';
  }

  if (activeFeedMode.value === 'following') {
    return 'No posts from followed users';
  }

  if (activeFeedMode.value === 'saved') {
    return 'No saved posts yet';
  }

  if (activeFeedMode.value === 'reported') {
    return 'No reported content';
  }

  return 'No posts yet';
}

function emptySubtitle(): string {
  if (hasPostSearchQuery.value) {
    return 'Try a different keyword.';
  }

  if (activeFeedMode.value === 'following') {
    return 'Follow people in the feed to see their posts here.';
  }

  if (activeFeedMode.value === 'saved') {
    return 'Saved posts will appear here for quick access.';
  }

  if (activeFeedMode.value === 'reported') {
    return 'Open reports will appear here for moderation.';
  }

  return 'Start the conversation with the first post.';
}

async function syncFeedModeFromRoute(): Promise<void> {
  if (!canModerate.value) {
    return;
  }

  const routeFilter = String(route.query.filter ?? '').toLowerCase();
  if (routeFilter === 'reported' && activeFeedMode.value !== 'reported') {
    await communityStore.setFeedMode('reported');
  }
}

onMounted(async () => {
  searchStore.clear();
  await communityStore.initialize();
  await syncFeedModeFromRoute();
});

watch(postSearchQuery, (query) => {
  if (searchDebounceId !== null) {
    window.clearTimeout(searchDebounceId);
  }

  searchDebounceId = window.setTimeout(() => {
    void searchStore.search({ query, type: 'post' });
  }, 300);
});

watch(
  () => route.query.filter,
  () => {
    void syncFeedModeFromRoute();
  }
);

onBeforeUnmount(() => {
  if (searchDebounceId !== null) {
    window.clearTimeout(searchDebounceId);
    searchDebounceId = null;
  }
});
</script>

<template>
  <section class="page-stack community-feed-page">
    <div class="page-header community-feed-header">
      <div>
        <h2>Community</h2>
      </div>
    </div>

    <div class="community-feed-shell">
      <form class="community-composer" @submit.prevent="submitPost">
        <textarea
          v-model="postDraft"
          class="input community-composer__input"
          maxlength="2000"
          rows="2"
          placeholder="Share an update with your studio community"
        />
        <div class="community-composer__controls">
          <select v-model="postTypeDraft" class="input community-composer__select">
            <option value="post">Post</option>
            <option value="question">Question</option>
          </select>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="communityStore.isSubmitting || !postDraft.trim()"
          >
            Post
          </button>
        </div>
      </form>

      <p v-if="communityStore.errorMessage" class="form-error community-feed-error">
        {{ communityStore.errorMessage }}
      </p>

      <div class="community-feed-tabs" role="tablist" aria-label="Community feed filters">
        <button
          v-for="tab in feedTabs"
          :key="tab.mode"
          type="button"
          class="community-feed-tabs__tab"
          :class="{ 'is-active': tab.mode === activeFeedMode }"
          role="tab"
          :aria-selected="tab.mode === activeFeedMode"
          @click="changeFeedMode(tab.mode)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div v-if="!isReportedMode" class="community-feed-search">
        <input
          v-model="postSearchQuery"
          class="input"
          type="search"
          placeholder="Search posts..."
        />
        <button
          v-if="hasPostSearchQuery"
          type="button"
          class="btn btn--ghost"
          @click="postSearchQuery = ''"
        >
          Clear
        </button>
      </div>
      <p v-if="!isReportedMode && hasPostSearchQuery && isSearchLoading" class="community-feed-search__hint">
        Searching posts...
      </p>
      <p v-else-if="!isReportedMode && hasPostSearchQuery && searchErrorMessage" class="form-error">
        {{ searchErrorMessage }}
      </p>

      <div v-if="isReportedMode" class="community-moderation-panel">
        <header class="community-moderation-panel__header">
          <h3>Reported Posts</h3>
          <p class="muted">Review reasons, resolve reports, and optionally delete reported content.</p>
        </header>

        <div v-if="moderationReports.length === 0" class="community-feed-empty">
          <p class="community-feed-empty__title">No reported posts</p>
          <p class="community-feed-empty__subtitle">Reported items will appear here with full context.</p>
        </div>

        <div v-else class="community-report-list">
          <article
            v-for="reportItem in moderationReports"
            :key="reportItem.report.id"
            class="community-report-item"
          >
            <header class="community-report-item__meta">
              <span class="community-report-item__badge">Reported</span>
              <span class="community-report-item__type">{{ reportTypeLabel(reportItem) }}</span>
              <span>·</span>
              <span>{{ formatAbsoluteTime(reportItem.report.createdAt) }}</span>
            </header>

            <p class="community-report-item__line">
              Reported by <strong>{{ reportItem.reporterDisplayName }}</strong>
            </p>
            <p class="community-report-item__line">
              Reason: <strong>{{ reportItem.report.reason }}</strong>
            </p>
            <p class="community-report-item__preview">{{ reportItem.targetContentPreview }}</p>

            <div class="community-report-item__actions">
              <button type="button" class="community-action" @click="resolveReport(reportItem)">
                Resolve
              </button>
              <button
                type="button"
                class="community-action community-action--danger"
                :disabled="reportItem.targetDeleted"
                @click="deleteReportedContent(reportItem)"
              >
                {{ reportItem.targetDeleted ? 'Content removed' : 'Delete content' }}
              </button>
            </div>
          </article>
        </div>
      </div>

      <div v-if="!isReportedMode && communityStore.isLoadingFeed" class="community-feed-empty">
        <p class="community-feed-empty__title">Loading feed</p>
        <p class="community-feed-empty__subtitle">Fetching local community activity.</p>
      </div>

      <div v-else-if="!isReportedMode && visibleFeed.length === 0" class="community-feed-empty">
        <p class="community-feed-empty__title">{{ emptyTitle() }}</p>
        <p class="community-feed-empty__subtitle">{{ emptySubtitle() }}</p>
      </div>

      <div v-else-if="!isReportedMode" class="community-feed-list">
        <article v-for="item in visibleFeed" :key="item.post.id" class="community-feed-item">
          <header class="community-feed-item__meta">
            <span class="community-feed-item__author">{{ item.authorDisplayName }}</span>
            <span class="community-feed-item__type" :class="{ 'is-question': item.post.type === 'question' }">
              {{ item.post.type === 'question' ? 'Question' : 'Post' }}
            </span>
            <span>·</span>
            <span>{{ formatRelativeTime(item.post.createdAt) }}</span>
            <span
              v-if="canModerate && item.reportCount > 0"
              class="community-feed-item__reports"
            >
              {{ item.reportCount }} report{{ item.reportCount > 1 ? 's' : '' }}
            </span>
          </header>

          <p class="community-feed-item__content">{{ item.post.content }}</p>
          <p
            v-if="hasPostSearchQuery && searchResultByPostId.get(item.post.id)?.highlightedExcerpt"
            class="search-result-snippet"
            v-html="searchResultByPostId.get(item.post.id)?.highlightedExcerpt"
          />

          <div class="community-feed-item__actions">
            <button type="button" class="community-action" @click="togglePostLike(item.post.id)">
              {{ item.likedByViewer ? 'Unlike' : 'Like' }}
              <span class="community-action__count">{{ item.post.likeCount }}</span>
            </button>
            <button type="button" class="community-action" @click="togglePostFavorite(item.post.id)">
              {{ item.favoritedByViewer ? 'Saved' : 'Save' }}
              <span class="community-action__count">{{ item.post.favoriteCount }}</span>
            </button>
            <button
              v-if="canFollowAuthor(item.post.authorId)"
              type="button"
              class="community-action"
              @click="toggleFollow(item.post.authorId)"
            >
              {{ item.authorFollowedByViewer ? 'Following' : 'Follow' }}
            </button>
            <button
              v-if="canBlockUser(item.post.authorId)"
              type="button"
              class="community-action"
              @click="toggleUserBlock(item.post.authorId)"
            >
              {{ isUserBlocked(item.post.authorId) ? 'Unblock' : 'Block user' }}
            </button>
            <button
              type="button"
              class="community-action"
              @click="setReplyTarget(item.post.id, null, 'Replying to post')"
            >
              Reply
            </button>
            <button type="button" class="community-action" @click="toggleReplies(item.post.id)">
              {{ isExpanded(item.post.id) ? 'Hide replies' : `View replies (${item.commentCount})` }}
            </button>
            <button type="button" class="community-action" @click="reportPost(item.post.id)">
              Report
            </button>
            <button
              v-if="canModerate && item.reportCount > 0"
              type="button"
              class="community-action"
              @click="resolvePostReports(item.post.id)"
            >
              Mark resolved
            </button>
            <button
              v-if="canModerate"
              type="button"
              class="community-action community-action--danger"
              @click="deletePost(item.post.id)"
            >
              Delete post
            </button>
          </div>

          <div v-if="isExpanded(item.post.id)" class="community-thread">
            <div v-if="communityStore.isThreadLoading(item.post.id)" class="community-thread__loading">
              Loading replies...
            </div>

            <template v-else>
              <div
                v-if="(threadForPost(item.post.id)?.comments.length ?? 0) === 0"
                class="community-thread__empty"
              >
                No replies yet.
              </div>

              <div v-else class="community-comment-list">
                <div
                  v-for="comment in threadForPost(item.post.id)?.comments ?? []"
                  :key="comment.comment.id"
                  class="community-comment"
                  :style="indentationStyle(comment)"
                  :class="{ 'is-answer': comment.isAcceptedAnswer }"
                >
                  <p class="community-comment__meta">
                    {{ formatMetaLabel(comment.authorDisplayName, comment.comment.createdAt) }}
                    <span v-if="comment.isAcceptedAnswer" class="community-comment__answer-badge">Accepted answer</span>
                    <span
                      v-if="canModerate && comment.reportCount > 0"
                      class="community-comment__reports"
                    >
                      {{ comment.reportCount }} report{{ comment.reportCount > 1 ? 's' : '' }}
                    </span>
                  </p>
                  <p class="community-comment__content">{{ comment.comment.content }}</p>
                  <div class="community-comment__actions">
                    <button
                      type="button"
                      class="community-action"
                      @click="toggleCommentLike(item.post.id, comment.comment.id)"
                    >
                      {{ comment.likedByViewer ? 'Unlike' : 'Like' }}
                      <span class="community-action__count">{{ comment.comment.likeCount }}</span>
                    </button>
                    <button
                      type="button"
                      class="community-action"
                      @click="setReplyTarget(item.post.id, comment.comment.id, `Replying to ${comment.authorDisplayName}`)"
                    >
                      Reply
                    </button>
                    <button
                      v-if="canBlockUser(comment.comment.authorId)"
                      type="button"
                      class="community-action"
                      @click="toggleUserBlock(comment.comment.authorId)"
                    >
                      {{ isUserBlocked(comment.comment.authorId) ? 'Unblock' : 'Block user' }}
                    </button>
                    <button
                      v-if="canMarkAnswer(item.post.type, item.post.authorId)"
                      type="button"
                      class="community-action"
                      :disabled="comment.isAcceptedAnswer"
                      @click="markAcceptedAnswer(item.post.id, comment.comment.id)"
                    >
                      {{ comment.isAcceptedAnswer ? 'Accepted' : 'Mark accepted' }}
                    </button>
                    <button
                      type="button"
                      class="community-action"
                      @click="reportComment(item.post.id, comment.comment.id)"
                    >
                      Report
                    </button>
                    <button
                      v-if="canModerate && comment.reportCount > 0"
                      type="button"
                      class="community-action"
                      @click="resolveCommentReports(item.post.id, comment.comment.id)"
                    >
                      Mark resolved
                    </button>
                    <button
                      v-if="canModerate"
                      type="button"
                      class="community-action community-action--danger"
                      @click="deleteComment(item.post.id, comment.comment.id)"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              <div v-if="replyLabel(item.post.id)" class="community-reply-target">
                <span>{{ replyLabel(item.post.id) }}</span>
                <button type="button" class="community-reply-target__clear" @click="clearReplyTarget(item.post.id)">
                  Clear
                </button>
              </div>

              <form class="community-comment-composer" @submit.prevent="submitComment(item.post.id)">
                <textarea
                  :value="commentDraft(item.post.id)"
                  class="input community-comment-composer__input"
                  rows="2"
                  maxlength="2000"
                  placeholder="Write a reply"
                  @input="setCommentDraft(item.post.id, ($event.target as HTMLTextAreaElement).value)"
                />
                <button
                  type="submit"
                  class="btn btn--primary"
                  :disabled="communityStore.isSubmitting || !commentDraft(item.post.id).trim()"
                >
                  Reply
                </button>
              </form>
            </template>
          </div>
        </article>
      </div>
    </div>
  </section>

  <AppModal
    :open="showReportModal"
    title="Report content"
    confirm-text="Submit report"
    :confirm-disabled="!reportReasonDraft.trim()"
    @cancel="closeReportModal"
    @confirm="submitReportModal"
  >
    <label class="field">
      <span class="field__label">Reason</span>
      <textarea
        v-model="reportReasonDraft"
        class="input community-report-reason-input"
        rows="3"
        maxlength="240"
        placeholder="Tell us why this content should be reviewed"
      />
      <span v-if="reportReasonError" class="field__error">{{ reportReasonError }}</span>
    </label>
  </AppModal>

  <AppModal
    :open="showConfirmModal"
    :title="confirmModalTitle"
    :message="confirmModalMessage"
    :confirm-text="confirmModalConfirmText"
    :confirm-variant="confirmModalVariant"
    @cancel="closeConfirmModal"
    @confirm="confirmModalAction"
  />
</template>
