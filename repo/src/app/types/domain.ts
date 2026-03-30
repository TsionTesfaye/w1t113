export type UserRole = 'admin' | 'photographer' | 'client' | 'moderator';
export type NotificationPreferenceType = 'booking' | 'messages' | 'community';

export interface UserNotificationPreferences {
  booking: boolean;
  messages: boolean;
  community: boolean;
}

export interface AdminNotificationSettings {
  booking: boolean;
  messages: boolean;
  community: boolean;
}

export interface AdminConfig {
  id: string;
  notificationSettings: AdminNotificationSettings;
  updatedAt: number;
}

export type SearchTokenizerStrategy = 'whitespace' | 'simple' | 'alphanumeric';

export interface SearchTokenizerConfig {
  strategy: SearchTokenizerStrategy;
  minTokenLength: number;
  stopwords?: string[];
}

export interface SearchConfig {
  synonyms: Record<string, string[]>;
  tokenizer: SearchTokenizerConfig;
  updatedAt: number;
}

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'arrived'
  | 'started'
  | 'rescheduled'
  | 'blocked'
  | 'canceled'
  | 'completed'
  | 'photographer_unavailable'
  | 'missed'
  | 'auto_completed';

export type BookingTimelineEventType = 'accepted' | 'arrived' | 'started' | 'ended';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  notificationPreferences: UserNotificationPreferences;
  blockedUserIds: string[];
  createdAt: number;
  failedAttempts: number;
  lockUntil: number | null;
}

export interface AuthenticatedUser extends User {
  passwordHash: string;
  salt: string;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  createdAt: number;
  expiresAt: number | null;
  rememberMe: boolean;
}

export interface ServiceItem {
  id: string;
  name: string;
  durationMinutes: number;
  price?: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TimeSlot {
  id: string;
  photographerId: string;
  startTime: number;
  endTime: number;
  isBooked: boolean;
}

export type AvailabilitySlot = TimeSlot;

export interface Photographer {
  id: string;
  name: string;
  isActive: boolean;
}

export interface SlotLock {
  id: string;
  slotId: string;
  photographerId: string;
  userId: string;
  startTime: number;
  endTime: number;
  dayKey: string;
  expiresAt: number;
}

export interface Booking {
  id: string;
  userId: string;
  photographerId: string;
  serviceId: string;
  slotId: string;
  startTime: number;
  endTime: number;
  dayKey: string;
  status: BookingStatus;
  createdByUserId?: string;
  createdByRole?: 'client' | 'admin';
  createdAt: number;
}

export interface BookingEvent {
  id: string;
  bookingId: string;
  type: BookingTimelineEventType;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface Thread {
  id: string;
  bookingId: string;
  participants: string[];
  createdAt: number;
}

export interface Message {
  id: string;
  threadId: string;
  senderId: string;
  senderRole?: UserRole;
  senderDisplayName?: string;
  content: string;
  createdAt: number;
  readBy: string[];
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  message: string;
  metadata: Record<string, unknown> | null;
  read: boolean;
  createdAt: number;
  dedupKey: string | null;
}

export interface NotificationPreference {
  userId: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  booking: boolean;
  messages: boolean;
  community: boolean;
}

export type FormFieldType = 'text' | 'textarea' | 'checkbox' | 'select' | 'radio' | 'file';
export type FormFieldConditionOperator = 'equals' | 'notEquals' | 'includes';
export type FormResponseStatus = 'draft' | 'submitted';

export interface FormFieldCondition {
  fieldId: string;
  operator: FormFieldConditionOperator;
  value: unknown;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
  helpText?: string;
  sensitive?: boolean;
  condition?: FormFieldCondition;
}

export interface FormTemplate {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  version: number;
  fields: FormField[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface FormTemplateSnapshot {
  id: string;
  name: string;
  description?: string;
  version: number;
  fields: FormField[];
}

export interface FormResponse {
  id: string;
  templateId: string;
  templateVersion: number;
  bookingId: string;
  userId: string;
  encryptedAnswers: string;
  status: FormResponseStatus;
  submittedAt: number | null;
  createdAt: number;
  updatedAt: number;
  templateSnapshot?: FormTemplateSnapshot;
}

export interface CommunityPost {
  id: string;
  authorId: string;
  authorRole: UserRole;
  type: 'post' | 'question';
  content: string;
  createdAt: number;
  likeCount: number;
  favoriteCount: number;
  acceptedAnswerId?: string;
}

export interface CommunityComment {
  id: string;
  postId: string;
  authorId: string;
  authorRole: UserRole;
  parentId: string | null;
  content: string;
  createdAt: number;
  likeCount: number;
}

export interface CommunityLike {
  id: string;
  userId: string;
  postId?: string;
  commentId?: string;
  createdAt: number;
}

export interface CommunityFavorite {
  id: string;
  userId: string;
  postId: string;
  createdAt: number;
}

export interface CommunityFollow {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: number;
}

export interface CommunityReport {
  id: string;
  reporterId: string;
  targetId: string;
  targetType: 'post' | 'comment';
  reason: string;
  createdAt: number;
  status: 'open' | 'resolved';
}

export interface OutboxMessage {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  messageHash: string;
  retryCount: number;
  nextRetryAt: string;
  status: 'pending' | 'processing' | 'failed' | 'completed';
}

export type SearchEntityType = 'booking' | 'user' | 'post';

export interface SearchIndexEntry {
  id: string;
  type: SearchEntityType;
  title: string;
  content: string;
  tokens: string[];
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  entityId: string;
  type: SearchEntityType;
  title: string;
  excerpt: string;
  score: number;
  highlights: string[];
  metadata: Record<string, unknown>;
  highlightedTitle: string;
  highlightedExcerpt: string;
}
