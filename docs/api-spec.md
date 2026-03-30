# StudioOps Frontend Simulated API Contract

## Runtime Reality (Important)

- StudioOps currently has **no runtime HTTP server and no real HTTP endpoints**.
- All API-like behavior is implemented as in-process TypeScript service calls inside the frontend.
- Runtime persistence is local (`IndexedDB` + `localStorage`) via repositories, not network I/O.
- This contract exists only to align future backend integration with the behavior already implemented in the frontend service layer.

## Source of Truth Used

- Service interfaces and error contracts under `src/services/*.ts`
- Domain models under `src/app/types/domain.ts`
- Explicit backend placeholder stubs:
  - `src/stubs/restContracts.ts`
  - `src/stubs/mysqlSchema.ts`
- Offline contract-style test baseline:
  - `API_tests/auth.api.test.ts`
- Local persistence schema:
  - `src/db/schema.ts`

## Contract Conventions

- IDs are strings (typically UUID-derived).
- Most timestamps are Unix epoch milliseconds (`number`).
- Scheduler/outbox retry timing uses ISO-8601 timestamp strings.
- Authorization is currently actor/user argument based (`actorId`, `userId`, `adminId`) inside services.
- No wire protocol, HTTP status code mapping, or auth header contract exists at runtime yet.

## Canonical DTO/Model Types

Primary shared contract types come from `src/app/types/domain.ts`, including:

- Identity and auth: `User`, `AuthenticatedUser`, `Session`
- Booking domain: `ServiceItem`, `TimeSlot`, `SlotLock`, `Booking`, `BookingStatus`
- Messaging: `Thread`, `Message`
- Notifications: `Notification`, `NotificationPreference`
- Health forms: `FormTemplate`, `FormField`, `FormResponse`
- Community: `CommunityPost`, `CommunityComment`, `CommunityReport`
- Search: `SearchIndexEntry`, `SearchResult`
- Operational: `OutboxMessage`, `AdminConfig`

## Explicit Future-Backend Stub Contracts (Already in Repo)

From `src/stubs/restContracts.ts`:

### `BookingResponseContract`

```ts
{
  id: string;
  userId: string;
  photographerId: string;
  serviceId: string;
  startTime: number;
  endTime: number;
  status: BookingStatus;
}
```

### `UserResponseContract`

```ts
{
  id: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  createdAt: number;
}
```

### `NotificationResponseContract`

```ts
{
  id: string;
  userId: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: number;
}
```

### `HealthFormResponseContract`

```ts
{
  id: string;
  bookingId: string;
  userId: string;
  templateId: string;
  templateVersion: number;
  encryptedAnswers: string;
  status: 'draft' | 'submitted';
  submittedAt: number | null;
}
```

From `src/stubs/mysqlSchema.ts` (placeholder table-shape stubs): `USERS_TABLE`, `BOOKINGS_TABLE`, `HEALTH_FORM_RESPONSES_TABLE`.

## Simulated Operation Catalog (Service-Level Contracts)

All signatures below are direct service contracts currently implemented in the frontend.

### Auth (`AuthService`)

Operations:

- `register(username: string, password: string) -> Promise<User>`
- `login(input: LoginInput) -> Promise<AuthenticatedSession>`
- `logout() -> Promise<void>`
- `loadSession() -> Promise<AuthenticatedSession | null>`
- `getCurrentSession() -> Promise<AuthenticatedSession | null>`
- `updateUser(actorId: string, targetUserId: string, updates: { username?: string }) -> Promise<User>`
- `updateNotificationPreferences(actorId: string, targetUserId: string, updates: Partial<UserNotificationPreferences>) -> Promise<User>`
- `blockUser(userId: string, targetUserId: string) -> Promise<User>`
- `unblockUser(userId: string, targetUserId: string) -> Promise<User>`
- `getBlockedUsers(actorId: string, targetUserId?: string) -> Promise<User[]>`
- `getAllUsers(actorId: string) -> Promise<User[]>`
- `getUsersByIds(actorId: string, userIds: string[]) -> Promise<User[]>`
- `findUserByUsername(actorId: string, username: string) -> Promise<User | null>`
- `changeUserRole(adminId: string, targetUserId: string, newRole: UserRole) -> Promise<User>`
- `setUserActiveStatus(adminId: string, targetUserId: string, isActive: boolean) -> Promise<User>`
- `createUserByAdmin(adminId: string, username: string, password: string, role: UserRole) -> Promise<User>`
- `getActiveEncryptionKey() -> CryptoKey | null` (browser-only helper, not HTTP-serializable)
- `getCachedEncryptionKeyForUser(userId: string) -> CryptoKey | null` (browser-only helper, not HTTP-serializable)

Typed errors (`AuthError.code`):

- `INVALID_CREDENTIALS`
- `INVALID_USERNAME`
- `ACCOUNT_LOCKED`
- `ACCOUNT_DISABLED`
- `USERNAME_ALREADY_EXISTS`
- `PASSWORD_TOO_SHORT`
- `FORBIDDEN`
- `USER_NOT_FOUND`
- `LAST_ADMIN_PROTECTION`
- `SELF_ACTION_FORBIDDEN`
- `SESSION_INVALID`

### Booking (`BookingService`)

Operations:

- `getServices() -> Promise<ServiceItem[]>`
- `getServiceCatalog(adminId: string) -> Promise<ServiceItem[]>`
- `createServiceItem(adminId: string, input: ServiceItemInput) -> Promise<ServiceItem>`
- `updateServiceItem(adminId: string, serviceId: string, input: ServiceItemInput) -> Promise<ServiceItem>`
- `archiveServiceItem(adminId: string, serviceId: string) -> Promise<ServiceItem>`
- `getAvailableSlots(serviceId: string, date: string) -> Promise<TimeSlot[]>`
- `getSlotsForDate(serviceId: string, date: string, userId: string) -> Promise<BookingSlotView[]>`
- `getSlotsForAdmin(adminId: string, serviceId: string, date: string, photographerId: string) -> Promise<BookingSlotView[]>`
- `lockSlot(slotId: string, userId: string, serviceId: string) -> Promise<SlotLock>`
- `confirmBooking(lockId: string, userId: string, serviceId: string) -> Promise<Booking>`
- `createBookingByAdmin(adminId: string, input: { clientId?: string; clientUsername?: string; photographerId?: string; photographerUsername?: string; serviceId: string; slotId?: string; startTime?: number }) -> Promise<Booking>`
- `blockPhotographerAvailability(photographerId: string, input: { startTime: number; endTime: number }) -> Promise<Booking>`
- `cancelLock(lockId: string, userId: string) -> Promise<void>`
- `getUserActiveLock(actorId: string, targetUserId?: string) -> Promise<SlotLock | null>`
- `getBookingsForUser(actorId: string, targetUserId?: string) -> Promise<Booking[]>`
- `getBookingsForPhotographer(userId: string) -> Promise<Booking[]>`
- `getBlockedAvailabilityForPhotographer(userId: string) -> Promise<Booking[]>`
- `getAllBookings(adminId: string) -> Promise<Booking[]>`
- `updateBookingStatus(userId: string, bookingId: string, nextStatus: BookingStatus) -> Promise<Booking>`
- `cancelBookingByUser(userId: string, bookingId: string) -> Promise<Booking>`
- `cancelBookingByAdmin(adminId: string, bookingId: string) -> Promise<Booking>`
- `updateBookingStatusByAdmin(adminId: string, bookingId: string, nextStatus: BookingStatus) -> Promise<Booking>`
- `markPhotographerUnavailableByAdmin(adminId: string, photographerId: string) -> Promise<number>`
- `processDueReminders(now?: number) -> Promise<number>` (system/background)
- `processOverdueItems(now?: number) -> Promise<number>` (system/background)
- `cleanupExpiredLocks(now?: number) -> Promise<number>` (system/background)

Typed errors (`BookingServiceError.code`):

- `SERVICE_NOT_FOUND`
- `INVALID_SERVICE`
- `SLOT_UNAVAILABLE`
- `LOCK_NOT_FOUND`
- `LOCK_EXPIRED`
- `ACTIVE_LOCK_EXISTS`
- `BOOKING_NOT_FOUND`
- `INVALID_STATUS_TRANSITION`
- `PAST_DATE_NOT_ALLOWED`
- `FORBIDDEN`
- `NO_PHOTOGRAPHERS_AVAILABLE`
- `INVALID_BOOKING`
- `CLIENT_NOT_FOUND`
- `PHOTOGRAPHER_NOT_FOUND`
- `BLOCKED_INTERACTION`

Implemented lifecycle constraints:

- Booking status values: `pending`, `confirmed`, `arrived`, `started`, `rescheduled`, `blocked`, `canceled`, `completed`, `photographer_unavailable`, `missed`, `auto_completed`
- Service-side transition maps are explicitly enforced in `BookingService.ts`

### Messaging (`MessageService`)

Operations:

- `getOrCreateThread(bookingId: string) -> Promise<Thread>`
- `getUserThreads(userId: string) -> Promise<ThreadSummary[]>`
- `getThreadMessages(threadId: string, userId: string) -> Promise<Message[]>`
- `sendMessage(threadId: string, senderId: string, content: string) -> Promise<Message>`
- `markThreadAsRead(threadId: string, userId: string) -> Promise<void>`
- `getUnreadThreadCount(userId: string) -> Promise<number>`
- `getThreadById(threadId: string, userId: string) -> Promise<Thread>`
- `getThreadAccessState(threadId: string, userId: string) -> Promise<ThreadAccessState>`

Typed errors (`MessageServiceError.code`):

- `BOOKING_NOT_FOUND`
- `BOOKING_NOT_ACTIVE`
- `THREAD_NOT_FOUND`
- `FORBIDDEN`
- `BLOCKED`
- `INVALID_MESSAGE`

### Notifications (`NotificationService`)

Operations:

- `createNotification(userId: string, type: string, message: string, metadata?: Record<string, unknown> | null, dedupKey?: string | null) -> Promise<Notification | null>` (service-internal producer contract)
- `getUserNotifications(actorId: string, userId: string) -> Promise<Notification[]>`
- `getNotificationPreference(actorId: string, userId: string) -> Promise<NotificationPreference>`
- `updateNotificationPreference(actorId: string, userId: string, updates: Partial<Pick<NotificationPreference, 'inAppEnabled' | 'emailEnabled' | 'smsEnabled' | 'booking' | 'messages' | 'community'>>) -> Promise<NotificationPreference>`
- `markAsRead(actorId: string, notificationId: string) -> Promise<void>`
- `markAllAsRead(actorId: string, userId: string) -> Promise<void>`
- `getUnreadCount(actorId: string, userId: string) -> Promise<number>`

Current service behavior includes:

- Per-user/day notification throttle by type
- Preference-based suppression
- Optional dedup by `dedupKey`

### Health Forms (`HealthFormService`)

Operations:

- `createTemplate(adminId: string, templateInput: FormTemplateInput) -> Promise<FormTemplate>`
- `updateTemplate(adminId: string, templateId: string, templateInput: FormTemplateInput) -> Promise<FormTemplate>`
- `getTemplates(actorId: string) -> Promise<FormTemplate[]>`
- `getActiveTemplates() -> Promise<FormTemplate[]>`
- `getAccessibleBookingForms(actorId: string) -> Promise<FormBookingSummary[]>`
- `getClientBookingForms(userId: string) -> Promise<FormBookingSummary[]>`
- `getFormForBooking(userId: string, bookingId: string) -> Promise<FormForBookingResult>`
- `getFormResponseForBooking(actorId: string, bookingId: string) -> Promise<FormForBookingResult>`
- `saveDraft(userId: string, bookingId: string, answers: Record<string, unknown>) -> Promise<FormResponse>`
- `submitForm(userId: string, bookingId: string, answers: Record<string, unknown>) -> Promise<FormResponse>`
- `getUserFormResponses(userId: string) -> Promise<FormResponse[]>`
- `evaluateVisibleFields(template: FormTemplate, answers: Record<string, unknown>) -> FormField[]` (local helper)
- `validateAnswers(template: FormTemplate, visibleFields: FormField[], answers: Record<string, unknown>) -> ValidationError[]` (local helper)
- `encryptAnswers(userId: string, plainAnswers: Record<string, unknown>) -> Promise<string>` (local helper)
- `decryptAnswers(userId: string, encryptedAnswers: string) -> Promise<Record<string, unknown>>` (local helper)
- `checkDuplicateSubmissionWindow(userId: string, bookingId: string) -> Promise<void>`

Typed errors (`HealthFormServiceError.code`):

- `FORBIDDEN`
- `USER_NOT_FOUND`
- `BOOKING_NOT_FOUND`
- `TEMPLATE_NOT_FOUND`
- `NO_ACTIVE_TEMPLATE`
- `INVALID_TEMPLATE`
- `INVALID_CONDITION`
- `INVALID_ANSWER`
- `VALIDATION_FAILED`
- `ENCRYPTION_KEY_UNAVAILABLE`
- `DECRYPTION_FAILED`
- `DUPLICATE_SUBMISSION`
- `BOOKING_CANCELED`

### Community (`CommunityService`)

Operations:

- `createPost(userId: string, role: UserRole, content: string, postType?: 'post' | 'question') -> Promise<CommunityPost>`
- `createComment(userId: string, role: UserRole, postId: string, parentId: string | null, content: string) -> Promise<CommunityComment>`
- `toggleLike(userId: string, targetType: CommunityLikeTargetType, targetId: string) -> Promise<CommunityToggleLikeResult>`
- `toggleFavorite(userId: string, postId: string) -> Promise<CommunityToggleFavoriteResult>`
- `toggleFollow(userId: string, targetUserId: string) -> Promise<CommunityToggleFollowResult>`
- `reportContent(userId: string, role: UserRole, targetType: CommunityReportTargetType, targetId: string, reason: string) -> Promise<CommunityReport>`
- `markReportsResolved(actorUserId: string, actorRole: UserRole, targetType: CommunityReportTargetType, targetId: string) -> Promise<number>`
- `getOpenReports(actorUserId: string, actorRole: UserRole) -> Promise<ModerationReportItem[]>`
- `resolveReport(actorUserId: string, actorRole: UserRole, reportId: string) -> Promise<CommunityReport>`
- `markAnswerAccepted(actorUserId: string, actorRole: UserRole, postId: string, commentId: string) -> Promise<CommunityPost>`
- `deletePost(actorUserId: string, actorRole: UserRole, postId: string) -> Promise<void>`
- `deleteComment(actorUserId: string, actorRole: UserRole, commentId: string) -> Promise<void>`
- `getFeed(viewerUserId: string) -> Promise<CommunityFeedItem[]>`
- `getFollowingFeed(viewerUserId: string) -> Promise<CommunityFeedItem[]>`
- `getSavedPosts(viewerUserId: string) -> Promise<CommunityFeedItem[]>`
- `getReportedContent(viewerUserId: string) -> Promise<CommunityFeedItem[]>`
- `getPostThread(postId: string, viewerUserId: string) -> Promise<CommunityPostThread>`

Typed errors (`CommunityServiceError.code`):

- `INVALID_CONTENT`
- `INVALID_POST_TYPE`
- `INVALID_REPORT_REASON`
- `FORBIDDEN`
- `POST_NOT_FOUND`
- `COMMENT_NOT_FOUND`
- `RATE_LIMIT_EXCEEDED`
- `REPLY_DEPTH_EXCEEDED`
- `USER_NOT_FOUND`
- `DUPLICATE_REPORT`
- `REPORT_NOT_FOUND`
- `SELF_FOLLOW_NOT_ALLOWED`
- `BLOCKED_INTERACTION`
- `INVALID_ANSWER_TARGET`

### Search (`SearchService`)

Operations:

- `search(actorId: string, query: string, type?: SearchEntityType) -> Promise<SearchResult[]>`
- `indexBooking(booking: Booking) -> Promise<void>` (service-internal indexing)
- `indexUser(user: User) -> Promise<void>` (service-internal indexing)
- `indexPost(post: CommunityPost) -> Promise<void>` (service-internal indexing)
- `removeIndexEntry(type: SearchEntityType, entityId: string) -> Promise<void>` (service-internal)
- `rebuildIndex(actorId: string) -> Promise<void>`
- `debugListIndexEntries(type?: SearchEntityType) -> Promise<SearchIndexEntry[]>`
- `getSynonyms(actorId: string) -> Promise<Record<string, string[]>>`
- `updateSynonyms(actorId: string, synonyms: Record<string, string[]>) -> Promise<Record<string, string[]>>`

Search entity types: `booking`, `user`, `post`.

### Admin Config (`AdminConfigService`)

Operations:

- `getConfig(actorId: string) -> Promise<AdminConfig>`
- `updateNotificationSettings(actorId: string, updates: Partial<AdminNotificationSettings>) -> Promise<AdminConfig>`

### Import/Export (`ImportExportService`)

Operations:

- `exportBackup(actorId: string) -> Promise<Blob>`
- `validateImport(actorId: string, rawJson: string) -> Promise<ImportValidationResult>`
- `importBackup(actorId: string, rawJson: string) -> Promise<void>`

Backup envelope contract (from service implementation):

```ts
{
  schemaVersion: number;
  exportedAt: number;
  stores: Record<StoreName, unknown[]>;
}
```

`schemaVersion` is validated against `DB_VERSION` from `src/db/schema.ts`.

### Outbox (`OutboxService`)

Operations:

- `enqueue(input: EnqueueOutboxInput) -> Promise<OutboxMessage>`
- `processDue(nowIso?: string) -> Promise<number>` (system/background)

### Scheduler (`SchedulerService`)

Operations:

- `runTick(nowIso?: string) -> Promise<SchedulerTickResult>` (system/background)
- `runStartupCatchUp(nowIso?: string) -> Promise<SchedulerTickResult>` (system/background)

### Crypto Helper (`CryptoService`)

Operations:

- `hashPassword(password: string, salt?: string) -> Promise<PasswordHashResult>`
- `verifyPassword(password: string, expectedHash: string, salt: string) -> Promise<boolean>`
- `encryptSensitive(payload: string, password: string) -> Promise<EncryptionPayload>`
- `decryptSensitive(payload: EncryptionPayload, password: string) -> Promise<string>`

This is currently a local cryptography contract, not a network API contract.

## Persistence Contract Baseline (Offline Runtime)

IndexedDB store contract names are defined in `src/db/schema.ts` and currently include:

- `users`, `sessions`, `serviceItems`, `slotLocks`, `bookings`
- `threads`, `messages`, `notifications`, `notificationPreferences`
- `formTemplates`, `formResponses`
- `posts`, `comments`, `likes`, `favorites`, `follows`, `reports`
- `searchIndex`, `outbox`, `schedulerState`, `appConfig`, plus other compatibility stores

## Integration Note

For the avoidance of doubt: **there are no live HTTP endpoints behind these contracts today**.  
These service-level contracts are documented to preserve current frontend behavior and provide a stable baseline for future backend endpoint design and mapping.
