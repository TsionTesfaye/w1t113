# questions.md

## 1. User Registration vs Predefined Accounts

**Question:** The prompt specifies pseudo-login but does not clarify whether users can register new accounts or must use predefined ones.
**Assumption:** Users can create accounts locally within the app.
**Solution:** Implemented a local registration flow storing user credentials securely in IndexedDB.

---

## 2. Password Storage & Key Derivation

**Question:** The prompt mentions PBKDF2 hashing and AES-GCM encryption but does not define how these interact.
**Assumption:** The password is used both for authentication (via PBKDF2 hash comparison) and for deriving an encryption key for sensitive data.
**Solution:** Used PBKDF2 (Web Crypto) to:

* store a salted password hash for login
* derive a separate AES-GCM key for encrypting sensitive IndexedDB fields

---

## 3. Encryption Scope

**Question:** The prompt states “sensitive fields” are encrypted but does not specify which exact fields qualify.
**Assumption:** Sensitive data includes health declarations, attachments, and any personally identifiable information.
**Solution:** Encrypted health form responses and attachments before storage in IndexedDB.

---

## 4. Session Management

**Question:** The prompt mentions a “Remember me” token but does not define its lifecycle or invalidation rules.
**Assumption:** The session token remains valid until logout or manual reset.
**Solution:** Stored a random session token in LocalStorage and cleared it on logout.

---

## 5. Failed Login Lockout

**Question:** The prompt specifies 5 failed attempts and a 15-minute lockout but does not define how this is tracked across sessions.
**Assumption:** Failed attempts are tracked per user in persistent storage.
**Solution:** Stored failed login attempts and timestamps in IndexedDB to enforce lockout across reloads.

---

## 6. Booking Slot Locking Behavior

**Question:** The prompt defines a 10-minute slot lock but does not specify behavior across multiple tabs.
**Assumption:** Slot locking is global within the same browser environment.
**Solution:** Stored lock state in IndexedDB with expiration timestamps and enforced checks before booking.

---

## 7. Booking State Transitions

**Question:** The allowed transitions between booking states (pending → confirmed → completed, etc.) are not explicitly defined.
**Assumption:** Booking states follow a strict lifecycle with no invalid backward transitions.
**Solution:** Implemented a state machine enforcing valid transitions only.

---

## 8. Duplicate Health Form Submission

**Question:** The prompt blocks duplicate submissions within 24 hours but does not define the scope (per booking or per user).
**Assumption:** The restriction applies per booking.
**Solution:** Stored submission timestamps per booking and enforced a 24-hour restriction.

---

## 9. Event Bus Reliability

**Question:** The prompt simulates real-time updates using an event bus but does not define persistence behavior.
**Assumption:** Events must persist across reloads.
**Solution:** Implemented an outbox queue in IndexedDB with retry logic and idempotency keys.

---

## 10. Retry & Deduplication Logic

**Question:** The retry mechanism is defined (5 attempts, exponential backoff) but deduplication criteria are not specified.
**Assumption:** Messages are uniquely identified by a hash of their payload.
**Solution:** Generated message hashes and skipped processing duplicates.

---

## 11. Scheduler Execution Scope

**Question:** The scheduler runs every 60 seconds while the app is open, but behavior when the app is closed is unclear.
**Assumption:** Missed jobs are executed on next app load.
**Solution:** On startup, the scheduler checks overdue tasks and processes them immediately.

---

## 12. Notification Limits

**Question:** The prompt limits notifications to 3 per type per day but does not define reset behavior.
**Assumption:** Limits reset every calendar day.
**Solution:** Stored notification counts per day and reset at midnight.

---

## 13. Community Rate Limits

**Question:** Rate limits are defined (posts/comments per hour) but enforcement timing is not specified.
**Assumption:** Limits are enforced using rolling time windows.
**Solution:** Stored timestamps of actions and validated limits dynamically.

---

## 14. Search Index Updates

**Question:** The prompt allows incremental updates and manual rebuild but does not define priority rules.
**Assumption:** Exact title matches should rank highest.
**Solution:** Implemented weighted scoring prioritizing titles over body text.

---

## 15. Data Import / Export Conflicts

**Question:** The prompt allows JSON import/export but does not define conflict resolution.
**Assumption:** Imported data overwrites existing data after validation.
**Solution:** Implemented schema validation and full replacement on import.

---

## 16. Multi-Role Handling

**Question:** The system defines multiple roles but does not clarify if a user can have more than one role.
**Assumption:** Each user has a single role.
**Solution:** Assigned one role per user and enforced role-based UI rendering.

---

## 17. Offline Constraints Enforcement

**Question:** The prompt requires fully offline operation but references backend technologies.
**Assumption:** Backend (Express/MySQL) is only for future integration.
**Solution:** Implemented all logic in frontend services using IndexedDB and mock interfaces.

---

## 18. Multi-Photographer Scheduling Model

**Question:** The prompt references photographers but does not define whether scheduling is single-resource or multi-resource.

**Assumption:** The system supports multiple photographers, each operating independently but sharing identical working hours and services.

**Solution:** Implemented automatic photographer assignment:

- Users do not choose a photographer
- The system selects the first available photographer during booking
- Availability is determined per photographer (no overlap per photographer)
- Overlapping bookings are allowed across different photographers

Additionally:

- Scheduling uses fixed time blocks based on service duration
- Sliding window slot generation is avoided to prevent overlapping start times
- A lunch break interval (12:00–13:00) is excluded from booking availability
