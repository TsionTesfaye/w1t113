# design.md

## 1. System Overview

StudioOps Offline Scheduling & Community is a fully offline-runnable Vue.js single-page application for photography studio operations and community engagement.

Primary roles:

* Administrator
* Photographer
* Client
* Moderator

Core capabilities:

* appointment booking and slot management
* in-app messaging and booking status timeline
* configurable health declaration templates and submissions
* community posts, comments, follows, likes, favorites, reports, and blocking
* in-app notifications
* back-office local search
* backup/export and restore/import

The application is designed to operate without an independent backend server. Business logic runs in a frontend service layer, persistent data is stored in IndexedDB, and lightweight session/UI preferences are stored in LocalStorage. Express + MySQL are treated only as future-integration stubs via TypeScript interfaces and schema-shaped models.

---

## 2. Design Goals

* Fully offline operation with no server dependency
* Clear separation of UI, business logic, persistence, and system services
* Reliable local persistence and recoverability
* Secure handling of sensitive local data
* Modular design that can later be connected to a real backend without major redesign
* Responsive, role-aware UI for desktop and mobile
* Deterministic local workflows for booking, notifications, forms, and moderation

---

## 3. High-Level Architecture

The system follows a layered offline-first architecture:

```text
Vue UI / Router / Components
        ↓
Application Services Layer
        ↓
Domain Repositories / IndexedDB Access Layer
        ↓
IndexedDB + LocalStorage
```

Supporting runtime layers:

* Event Bus
* Outbox Queue
* Scheduler
* Crypto Service
* Search Index Service
* Import/Export Service

### Architecture principle

The local database is the source of truth. UI components do not contain business rules directly. All workflow logic lives in services.

### Offline-first Principle

All features must function without network connectivity.
Any reference to backend systems (Express + MySQL) is purely structural and not executed at runtime.

All writes are committed locally first and treated as the source of truth.

---

## 4. Repository Abstraction (Backend-Ready Design)

To support future backend integration, the system introduces a repository abstraction layer between services and persistence.

Each domain module defines:

* a repository interface (TypeScript)
* a concrete IndexedDB implementation

Current flow:
Service → Repository → IndexedDB

Future flow (when backend is introduced):
Service → Repository → API (Express) → MySQL

This ensures:

* business logic remains unchanged
* persistence layer can be swapped without affecting services
* the system aligns with the “Express + MySQL as stubs” requirement

---

## 5. Frontend Architecture

### 5.1 Framework

* Vue.js SPA
* Vue Router
* TypeScript
* Responsive layouts for desktop and phone

### 5.2 Route Areas

* `/login`
* `/booking`
* `/messages`
* `/community`
* `/forms`
* `/admin`
* `/search`

### 5.3 UI Composition

The interface is organized into:

* app shell
* role-aware navigation
* page-level views
* reusable domain components
* shared status/notification primitives

### 5.4 Major UI Components

* booking calendar
* booking drawer with slot hold timer
* booking status timeline / stepper
* service item list
* health form wizard
* community thread view
* notification center
* search results panel with highlights
* admin template/config editor

---

## 6. Application Services Layer

All business logic is implemented in frontend services.

### 6.1 AuthService

Responsibilities:

* registration and local pseudo-login
* password verification
* failed-attempt lockout enforcement
* remember-me token management
* current session retrieval
* logout

### 6.2 BookingService

Responsibilities:

* service listing
* photographer availability lookup
* slot hold acquisition and release
* booking creation
* booking conflict detection
* booking lifecycle transitions
* reschedule/cancel/complete handling

### 6.3 MessagingService

Responsibilities:

* booking-related message generation
* status timeline event recording
* local thread/message retrieval
* notification preference checks

### 6.4 NotificationService

Responsibilities:

* create in-app notifications
* frequency-limit enforcement
* notification center queries
* notification state updates (read/unread)

### 6.5 HealthFormService

Responsibilities:

* template management
* conditional visibility evaluation
* required-rule enforcement
* draft saving
* submission validation
* duplicate-submit prevention

### 6.6 CommunityService

Responsibilities:

* post and comment CRUD
* threaded replies
* likes, favorites, follows
* report/block workflows
* rate-limit enforcement
* moderator actions

### 6.7 SearchService

Responsibilities:

* local indexing
* tokenizer and synonym support
* incremental index updates
* manual rebuild
* search ranking and highlighting

### 6.8 SchedulerService

Responsibilities:

* run recurring local jobs every 60 seconds
* process due reminders
* process overdue items
* process slot hold expirations
* process missed tasks on app startup

### 6.9 OutboxService

Responsibilities:

* enqueue simulated sync/status events
* assign idempotency keys
* retry failed processing with exponential backoff
* deduplicate by message hash

### 6.10 CryptoService

Responsibilities:

* PBKDF2 password hashing
* AES-GCM encryption/decryption
* password-derived key handling
* masking-sensitive-field helpers

### 6.11 ImportExportService

Responsibilities:

* backup export to JSON file
* import/restore from JSON file
* schema validation
* safe replace/reset behavior

---

## 7. Data Persistence Design

### 7.1 Primary Storage

IndexedDB is the primary persistent store.

### 7.2 Secondary Storage

LocalStorage stores:

* session token
* remember-me token
* lightweight UI preferences
* non-sensitive view flags

### 7.3 IndexedDB Stores

Planned stores:

* users
* sessions
* serviceItems
* photographers
* availabilitySlots
* slotLocks
* bookings
* bookingEvents
* messages
* notifications
* notificationPreferences
* healthTemplates
* healthDrafts
* healthSubmissions
* posts
* comments
* likes
* favorites
* follows
* reports
* blocks
* searchIndex
* outbox
* schedulerState
* appConfig
* auditEvents

### 7.4 Key Persistence Principle

Repositories own IndexedDB interactions. Services do not manipulate raw IndexedDB directly.

### 7.5 Schema Versioning

The IndexedDB schema includes a version number.

Database upgrades are handled through controlled migration steps to ensure compatibility across application updates and imports.

---

## 8. Domain Model Overview

### 8.1 User

Fields:

* id
* username
* passwordHash
* passwordSalt
* role
* failedLoginCount
* lockoutUntil
* rememberToken
* createdAt
* updatedAt

### 8.2 Booking

Fields:

* id
* clientId
* photographerId
* serviceItemId
* slotId
* status
* holdExpiresAt
* createdAt
* updatedAt

Statuses:

* pending
* confirmed
* rescheduled
* canceled
* completed

### 8.3 SlotLock

Fields:

* id
* slotId
* bookingCandidateId
* lockedByUserId
* expiresAt

### 8.4 BookingEvent

Fields:

* id
* bookingId
* type
* createdAt
* metadata

Timeline types:

* accepted
* arrived
* started
* ended

### 8.5 HealthTemplate

Fields:

* id
* name
* fields
* rules
* version
* createdAt
* updatedAt

### 8.6 HealthSubmission

Fields:

* id
* bookingId
* clientId
* templateVersion
* encryptedPayload
* submittedAt

### 8.7 CommunityPost

Fields:

* id
* authorId
* kind
* title
* body
* createdAt
* updatedAt

Kinds:

* thread
* question

### 8.8 Notification

Fields:

* id
* userId
* type
* title
* body
* read
* createdAt

### 8.9 OutboxMessage

Fields:

* id
* type
* payload
* idempotencyKey
* messageHash
* retryCount
* nextRetryAt
* status

---

## 9. Authentication and Security Design

### 9.1 Authentication Model

* local pseudo-login using username and password
* no external auth provider
* optional remember-me token in LocalStorage
* token stores only random session identifier, not password

### 9.2 Password Handling

* password hashed using PBKDF2 via Web Crypto
* per-user salt stored alongside password hash
* verification performed locally

### 9.3 Lockout Rules

* 5 failed attempts
* 15-minute lockout
* failed-attempt state persisted locally

### 9.4 Encryption at Rest

Sensitive data is encrypted before persistence in IndexedDB using AES-GCM.

Sensitive data includes at minimum:

* health declaration answers
* attachments
* other fields marked sensitive by configuration

### 9.5 Key Derivation Boundary

Encryption keys are derived from the user password. Password reset without the original password is treated as loss of access to previously encrypted fields.

### 9.6 Security Limitation

Because encryption keys are derived from the user password, losing the password results in permanent loss of access to encrypted data.

No password recovery mechanism exists in offline mode.

### 9.7 Masking

Sensitive values are masked by default in UI and revealed only in authorized contexts.

---

## 10. Booking and Slot-Hold Design

### 10.1 Booking Flow

1. client selects service item
2. client selects available slot
3. slot hold is created for 10 minutes
4. booking drawer opens
5. client confirms or cancels
6. hold is released on confirm, cancel, or timeout
7. booking enters lifecycle state

### 10.2 Conflict Detection

A slot cannot be booked if:

* already booked
* currently held and unexpired by another pending booking flow

### 10.3 Hold Expiration

Holds are evaluated by:

* countdown in UI
* scheduler sweep
* startup reconciliation

### 10.4 Booking Integrity

Booking creation is atomic at the service/repository level to prevent duplicate claims on the same slot.

## 10.5 Multi-Photographer Scheduling (Auto-Assignment)

The system supports multiple photographers operating under identical working hours and service offerings.

Clients do not select a photographer manually. Instead, the system automatically assigns an available photographer during booking.

### Assignment Logic

When a client selects a time slot:

1. The system evaluates all active photographers
2. Filters photographers with:
   - no overlapping bookings
   - no active locks for the selected time range
3. Assigns the first available photographer
4. Creates a slot lock tied to that photographer

### Overlap Rule

Bookings must not overlap for the same photographer:

start < existingBooking.end AND end > existingBooking.start

Overlapping bookings across different photographers are allowed.

---

## 10.6 Fixed Time Block Scheduling

The system uses fixed, non-overlapping time blocks aligned to service duration.

### Slot Generation

Slots are generated by stepping through working hours using the selected service duration:

Examples:

- 30-minute service:
  - 09:00–09:30, 09:30–10:00, ...

- 90-minute service:
  - 09:00–10:30, 10:30–12:00, 12:00–01:30, ...

Sliding-window slot generation is not used.

Each slot represents a valid start time and does not overlap with adjacent slots.

---

## 10.7 Lunch Break Exclusion

The system defines a non-bookable lunch interval:

- lunchStart = 12:00
- lunchEnd = 13:00

Any slot that overlaps this interval is excluded:

slot.start < lunchEnd AND slot.end > lunchStart

Such slots are not rendered in the UI and cannot be booked.

---

## 10.8 Slot Availability Definition (Multi-Photographer)

A time slot is considered available if:

- at least one photographer is free for the entire duration

A slot is not shown if:

- no photographers are available
- the slot overlaps lunch
- the slot falls outside working hours

---

## 11. Messaging and Notifications Design

### 11.1 Messaging

Messaging is local-first and tied to booking/status workflows.

### 11.2 Status Timeline

Booking events are stored and rendered as a stepper:

* accepted
* arrived
* started
* ended

### 11.3 Notification Preferences

Each user can configure notification preferences:

* in-app enabled
* email visible but disabled in offline mode
* SMS visible but disabled in offline mode

### 11.4 Notification Limits

No more than 3 notifications of the same type per day per user.

---

## 12. Health Form Engine Design

### 12.1 Admin Template Builder

Admins can define:

* field list
* field type
* required rules
* conditional show/hide rules

### 12.2 Client Rendering

Clients receive the form as a wizard:

* step-by-step navigation
* draft save
* confirmation modal on submit

### 12.3 Duplicate Submission Prevention

A submission is blocked if the same booking already has a successful submission within the past 24 hours.

### 12.4 Versioning

Submitted forms retain the template version used at submission time.

---

## 13. Community and Moderation Design

### 13.1 Community Features

* threaded comments
* likes
* favorites
* follows
* Q&A posts
* reports
* user blocking

### 13.2 Rate Limits

* max 10 posts/hour/account
* max 30 comments/hour/account

Rate limits use rolling time windows based on persisted timestamps.

### 13.3 Moderation

Moderators can:

* review reports
* hide/flag content
* review blocked relationships
* manage abusive interactions

---

## 14. Search Design

### 14.1 Indexed Search Scope

Local search indexes:

* bookings
* profiles
* posts

### 14.2 Search Features

* tokenizer configuration
* synonym configuration
* incremental index updates on save
* manual rebuild
* highlighting in results

### 14.3 Ranking

Ranking prioritizes:

1. exact title matches
2. title token matches
3. body matches

---

## 15. Event Bus, Outbox, and Retry Design

### 15.1 Event Bus

Used for in-app reactive updates while the application is open.

### 15.2 Outbox

Persistent outbox ensures events survive reloads and failed processing.

### 15.3 Idempotency

Each outbox item has:

* idempotency key
* message hash

Deduplication is based on message hash and successful prior processing.

### 15.4 Retry Policy

* maximum 5 retries
* exponential backoff
* terminal failure state after retry exhaustion

---

## 16. Scheduler Design

### 16.1 Interval

Runs every 60 seconds while the app is open.

### 16.2 Scheduled Responsibilities

* slot hold expiration
* due reminders
* overdue item scans
* notification generation
* deferred outbox processing

### 16.3 Startup Catch-Up

On startup, the scheduler processes missed due work so reminders and expirations are reconciled after downtime.

---

## 17. Import/Export and Recovery Design

### 17.1 Export

Exports all persisted data as validated JSON via browser download.

### 17.2 Import

Imports JSON after schema validation.

### 17.3 Restore Policy

Default restore behavior replaces current local data after validation succeeds.

### 17.4 Recovery

A full import acts as local restore/recovery. Invalid payloads are rejected before mutation.

---

## 18. Error Handling Strategy

* user-facing failures produce clear inline or toast feedback
* invalid operations are blocked in services, not just UI
* storage, crypto, and parsing failures are surfaced with recoverable messaging where possible
* no silent failure for booking, submission, or authentication flows

---

## 19. Logging and Diagnostics

Because this is a frontend-only offline system, logging is local and developer-oriented.

Planned logging:

* auth attempts
* booking actions
* slot lock events
* scheduler runs
* outbox retries/failures
* import/export operations
* moderation actions

Optional diagnostic logs may be stored in IndexedDB for debug/export.

---

## 20. Testing Strategy

### 20.1 Unit Tests

Focus areas:

* auth hashing/lockout
* booking conflict detection
* slot hold expiration
* duplicate submission prevention
* rate-limit enforcement
* outbox retry/deduplication
* scheduler due-item detection
* search ranking

### 20.2 UI / Component Tests

Focus areas:

* login flow
* booking drawer and timeout behavior
* status stepper rendering
* health form conditional rendering
* notification center rendering
* role-aware navigation

### 20.3 End-to-End Flows

* register/login/logout
* hold slot and confirm booking
* hold slot and timeout release
* submit health form and block duplicate within 24 hours
* create community post/comment under rate limits
* generate and view notifications
* export and restore local data

---

## 21. Future Integration Readiness

Although offline-first is the current runtime model, the design remains integration-ready by:

* using repository abstractions
* defining payload-shaped TypeScript interfaces
* separating service logic from persistence implementation
* isolating event/sync concerns in outbox abstractions

This allows future replacement of local repositories with real API-backed adapters without redesigning the domain workflows.

---

## 22. System Hardening Considerations

### 22.1 Multi-Tab Coordination

To prevent concurrent execution of scheduler and outbox logic across multiple browser tabs, a leader-election mechanism is used.

Only one active tab performs background processing, while others remain passive.

### 22.2 Transactional Operations

Critical workflows (e.g., slot locking, booking creation, rescheduling) are executed within atomic repository-level transactions to ensure consistency.

### 22.3 Time Consistency Handling

All time-based logic (locks, rate limits, reminders) is centralized in a TimeService to reduce inconsistencies caused by local clock changes.

### 22.4 Startup Reconciliation

On application startup, the system performs a reconciliation pass to resolve:

* expired slot locks
* pending outbox messages
* overdue scheduler tasks

### 22.5 Idempotent Operations

All mutating operations are designed to be idempotent where applicable to prevent duplicate effects from repeated actions.

---
