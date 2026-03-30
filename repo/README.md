# StudioOps Offline Scheduling & Community

StudioOps is a fully offline-first Vue 3 + TypeScript single-page application for photography studio operations.

## What Is Implemented

- Booking system with slot-based scheduling, lock/hold flow, conflict detection, and status lifecycle transitions.
- Background scheduler (while app is open) for reminders, overdue handling (missed/auto-complete), and lock cleanup.
- Messaging system tied to booking threads with booking-status-based read-only behavior.
- Health form engine with admin-managed templates, conditional wizard flow, encrypted responses, and duplicate-submit protection.
- Local back-office search with configurable tokenization, synonym expansion, ranking, and result highlighting.
- Role-based access control for Admin, Photographer, Client, and Moderator across routes and service logic.
- Import/export backup workflow for local IndexedDB with schema and relational integrity validation.
- Offline architecture with IndexedDB as primary persistence and LocalStorage for session/UI preferences.

## Tech Stack

- Vue 3
- TypeScript
- Pinia
- Vue Router
- IndexedDB
- Vite
- Vitest

## Verification

```bash
npm install
npm run dev
npm run test
npm run build
./run_tests.sh
```

## Search Configuration

Admin search behavior is configurable at runtime from `/admin/data`:

- Tokenizer strategy: `whitespace`, `simple`, or `alphanumeric`
- Minimum token length
- Stopword list (JSON array)
- Synonym map (JSON object)

After changing tokenizer or synonym settings, click **Rebuild index** so existing indexed entries are re-tokenized with the new configuration.

## Docker Setup

```bash
docker compose up --build
```

Then open:
[http://localhost:4173](http://localhost:4173)

No environment variables are required to start the app in Docker. The checked-in default is secure (`VITE_AUTH_SEED_DEFAULT_ADMIN=false`).

## Non-Docker Verification

1. Run:
   ```bash
   npm install
   npm run dev
   ```
2. Open the local URL printed by Vite.
3. Verify expected outcomes:
   - Bootstrap first admin on `/login` (first run only)
   - Sign in and create a booking (new booking starts as `pending`)
   - Confirm booking as photographer (`pending -> confirmed`)
   - Messaging becomes available for the active booking
   - Submit health form once; second submission within 24h is blocked
   - Search results are role-filtered (non-admin users do not receive `user` entities)
4. Confirm runtime model:
   - No backend is required
   - Data persists in IndexedDB
   - The app remains fully offline-first

## Docker Verification

1. Run:
   ```bash
   docker compose up --build
   ```
2. Open:
   [http://localhost:4173](http://localhost:4173)
3. Verify expected outcomes:
   - App shell loads with login/bootstrap flow
   - Booking, messaging, forms, and search flows behave exactly as above
4. Stop services:
   ```bash
   docker compose down
   ```

## First-Run Admin Bootstrap (Production-Safe)

On a fresh install with no admin user:

1. Open `/login`
2. Complete **Create first admin**
3. Sign in with the admin account you just created

Important behavior:

- There are no default credentials.
- Bootstrap is one-time only and is automatically disabled after the first admin exists.
- Development seeding can only run when explicitly enabled in DEV mode.

## Clean-DB First-Run Setup (Deterministic)

Use these exact steps on a fresh browser profile / empty IndexedDB:

1. Bootstrap and sign in as the first admin on `/login`.
2. Open `/admin/users`:
   - Create one `photographer` user.
   - Create one `client` user.
3. Open `/admin/bookings`:
   - In **Service Catalog**, click **New service** and create at least one active service.
4. Open `/admin/forms`:
   - Create one active health template with at least one required field.
5. Sign out admin, sign in as the client:
   - Open `/booking`, select service/date/slot, confirm booking.
   - New booking appears in `pending` status.
6. Sign out client, sign in as the photographer:
   - Open `/photographer/schedule`, click **Confirm** on the pending booking.
   - Booking transitions to `confirmed`.

This flow is covered by integration test:
- `unit_tests/integration/CrossFeatureIntegration.test.ts`
- case: `clean-db first-run reproducibility: ...`

## Staff Forms Access Model

- Client responses remain encrypted with a client-session key.
- Staff roles (`admin`, `photographer`) can see response status metadata in `/forms/responses`.
- Staff answer payload viewing is disabled in UI to avoid contradictory decrypt expectations.
- Client answer viewing/editing remains available through `/forms/:bookingId`.

## API Tests

- `API_tests/` contains contract-style tests for offline service behavior.
- StudioOps has no backend runtime; the service layer simulates API behavior locally.
- These tests validate expected request/response contracts (for example auth login outcomes) without network calls.

## Additional Test Commands

```bash
npm run test:component
npx playwright install chromium
npm run test:e2e
```

`npm run test:e2e` executes the Playwright suite in `e2e_tests/`, including:

- clean-db bootstrap + booking/forms acceptance smoke
- auth + role guard flow
- booking hold expiry + duplicate prevention flow
- forms duplicate submission enforcement flow
- notifications always-on flow
- search tokenizer config behavior flow

## Backend Contract Stubs

- `src/stubs/restContracts.ts` defines TypeScript interfaces mirroring future REST payloads.
- `src/stubs/mysqlSchema.ts` defines MySQL table-shape placeholders for future integration.
- Both are development-time stubs only; runtime remains fully offline-first.

## High-Level Architecture

```text
Vue Views + Components + Router
          ↓
Pinia Stores (state + UI actions)
          ↓
Service Layer (business rules + authorization)
          ↓
Repository Layer (IndexedDB persistence)
          ↓
IndexedDB + LocalStorage
```

## Primary Routes

- `/booking`
- `/my-bookings`
- `/messages`
- `/community`
- `/forms`
- `/forms/responses`
- `/admin/dashboard`
- `/admin/bookings`
- `/admin/users`
- `/admin/forms`
- `/admin/data`
