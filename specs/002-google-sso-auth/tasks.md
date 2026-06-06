---
description: "Task list for 002-google-sso-auth implementation"
---

# Tasks: Google SSO Authentication & Access Protection

**Input**: Design documents from `/specs/002-google-sso-auth/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml

**Tests**: MANDATORY per Constitution Principle I (Test-Driven Development, NON-NEGOTIABLE). Test
tasks are written before/alongside the implementation they cover and must fail first.

**Stack** (from plan.md): TypeScript on Node 22, npm workspaces (`server/`, `client/`, `shared/`).
Server: Express 5 + better-sqlite3 + `google-auth-library` + `jose` + `cookie-parser`. Client:
React 18 + Vite 5 + `react-router-dom`. Tests: Vitest + Supertest + React Testing Library +
Playwright. Contract `contracts/openapi.yaml` is the single source of typed shapes (`shared/src/api.ts`).

**Format**: `[ID] [P?] [Story?] Description with file path` — `[P]` = parallelizable (different
files, no incomplete deps).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and contract/type plumbing for the auth feature.

- [X] T001 Add server auth dependencies (`google-auth-library`, `jose`, `cookie-parser`, and `@types/cookie-parser`) to `server/package.json` and install
- [X] T002 [P] Add `react-router-dom` to `client/package.json` and install
- [X] T003 [P] Merge auth additions from `specs/002-google-sso-auth/contracts/openapi.yaml` into the runtime `contracts/openapi.yaml` (cookie `securityScheme`, `/auth/*` routes, `401` on `/note`, `User` schema, `/test/login`)
- [X] T004 Regenerate shared API types via `npm run gen:api` and verify `shared/src/api.ts` includes `User` and auth/401 shapes (depends on T003)
- [X] T005 [P] Create `server/.env.example` documenting `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `AUTH_JWT_SECRET`, and the test-only `AUTH_TEST_MODE`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core auth machinery every user story depends on — DB schema, token/cookie/session
utilities, the `requireAuth` middleware, the session-read/refresh endpoints, the env-gated
test-login seam, and the client auth context. 

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Config & schema

- [X] T006 [P] Typed env loader with startup validation (required Google + `AUTH_JWT_SECRET`; optional `AUTH_TEST_MODE`) in `server/src/config/env.ts`
- [X] T007 Add `user` and `session` tables (+ indexes on `session.token_hash`, `session.user_id`) to the migration in `server/src/db/index.ts` (note table unchanged) per `data-model.md`

### Tests first (core utilities)

- [X] T008 [P] Unit tests for token utilities (access JWT sign/verify with ~1h exp; refresh token generate/hash/rotate) in `server/tests/unit/tokens.test.ts`
- [X] T009 [P] Unit tests for session-repo (create, find-by-hash, rotate-and-slide-24h, expire, delete) in `server/tests/unit/session-repo.test.ts`
- [X] T010 [P] Integration test for `requireAuth` (no token / invalid / expired → 401 `{error:"UNAUTHORIZED"}`; valid → passes) in `server/tests/integration/require-auth.test.ts`
- [X] T011 [P] Integration test for `GET /api/auth/me` and `POST /api/auth/refresh` (refresh rotates token & slides expiry; ≥24h inactivity → 401) in `server/tests/integration/auth-session.test.ts`

### Implementation (core utilities)

- [X] T012 Token utilities (`jose` access JWT ~1h; opaque refresh gen + SHA-256 hash + rotate) in `server/src/auth/tokens.ts` (satisfies T008)
- [X] T013 [P] user-repo (`upsertUser`, `getUser`, `last_login_at`) in `server/src/db/user-repo.ts`
- [X] T014 session-repo (`createSession`, `findByTokenHash`, `rotate`, `deleteById`, `sweepExpired`) in `server/src/db/session-repo.ts` (satisfies T009, depends on T007)
- [X] T015 Cookie helpers (set/clear access, refresh, handshake cookies — httpOnly/Secure/SameSite=Lax; refresh cookie path-scoped) in `server/src/auth/cookies.ts`
- [X] T016 `requireAuth` middleware (verify access JWT, attach typed `req.user`, else 401) in `server/src/auth/require-auth.ts` (satisfies T010, depends on T012)
- [X] T017 Wire `cookie-parser` and mount the `/api/auth` router skeleton + `AUTH_TEST_MODE` gating in `server/src/app.ts` (extend existing `AppOptions`)
- [X] T018 Implement `GET /api/auth/me` and `POST /api/auth/refresh` (rotate session, re-issue ~1h access cookie; 401 on expired/revoked) in `server/src/auth/routes.ts` (satisfies T011, depends on T012, T014, T015)

### Test-login seam (enables testing all stories — research.md D6)

- [X] T019 Test-login handler minting the SAME access+refresh cookies for a deterministic fake user, mounted only when `AUTH_TEST_MODE=1`, in `server/src/test-support/test-login.ts`; mount in `server/src/app.ts` mirroring the existing `enableTestReset` gate (depends on T012, T014, T015)
- [X] T020 [P] Contract test validating `/auth/me`, `/auth/refresh`, and 401 `Error` shapes against `contracts/openapi.yaml` in `server/tests/contract/auth.test.ts`

### Client auth foundation

- [X] T021 [P] Wrap the app in `<BrowserRouter>` and `<AuthProvider>` in `client/src/main.tsx`
- [X] T022 `AuthProvider` + `useAuth` hook (loads `GET /api/auth/me`, exposes `user`, `loading`, and a `signOut` stub) in `client/src/auth/AuthProvider.tsx` and `client/src/auth/useAuth.ts`
- [X] T023 Refresh-aware fetch wrapper (on 401 → `POST /api/auth/refresh` once → retry; on refresh failure → surface unauthenticated) in `client/src/api/http.ts`

### E2E foundation

- [X] T024 Add `AUTH_TEST_MODE: "1"` to the server `webServer` env in `playwright.config.ts` and add a session-seeding helper (calls `POST /api/test/login`, reuses cookies) in `e2e/support/auth.ts`

**Checkpoint**: Auth machinery ready — sessions can be minted (real flow pending US1; fake flow via T019), endpoints can be guarded, and the client knows who is signed in.

---

## Phase 3: User Story 1 - Sign in with Google (Priority: P1) 🎯 MVP

**Goal**: A visitor completes Google sign-in and the server establishes a session (FR-001–004).

**Independent Test**: With `google-auth-library` mocked, hitting `/auth/google/start` then
`/auth/google/callback` provisions a `user`, sets access+refresh cookies, and `/auth/me` returns
the user; cancel/deny redirects to `/login` with an error.

### Tests for User Story 1 (write first, must fail)

- [X] T025 [P] [US1] Integration test: `GET /api/auth/google/start` sets the signed handshake (state+PKCE) cookie and 302-redirects to Google, honoring `?next=` (Google mocked) in `server/tests/integration/google-start.test.ts`
- [X] T026 [P] [US1] Integration test: `GET /api/auth/google/callback` validates `state`, exchanges the code, provisions/updates the user, sets session cookies, and redirects to `next`/`/`; cancel/deny (`?error=`) redirects to `/login?error=...` in `server/tests/integration/google-callback.test.ts`
- [X] T027 [P] [US1] Contract test: `/auth/google/start` and `/auth/google/callback` redirect behavior vs `contracts/openapi.yaml` in `server/tests/contract/google.test.ts`

### Implementation for User Story 1

- [X] T028 [US1] Google wrapper (build auth URL with PKCE+state; exchange code; verify ID token → `{sub,email,name}`) over `google-auth-library` in `server/src/auth/google.ts` (satisfies T025, T026)
- [X] T029 [US1] Implement `GET /api/auth/google/start` (set handshake cookie, redirect to Google) in `server/src/auth/routes.ts` (depends on T028, T015)
- [X] T030 [US1] Implement `GET /api/auth/google/callback` (validate state, exchange, `upsertUser`, create session, set cookies, redirect to `next`/`/`; on error → `/login?error`) in `server/src/auth/routes.ts` (depends on T028, T013, T014, T015)

**Checkpoint**: Real Google sign-in issues a session end-to-end (verified with Google mocked).

---

## Phase 4: User Story 2 - Protected pages block unauthorized access (Priority: P1)

**Goal**: Unauthenticated visitors are redirected from any protected page to `/login` and returned
afterward; the login page is accessible (FR-008–010, FR-013, FR-015).

**Independent Test**: Visiting `/` while signed out redirects to `/login?next=/`; after seeding a
session the note page renders; the login page exposes an accessible "Sign in with Google" control.

### Tests for User Story 2 (write first, must fail)

- [X] T031 [P] [US2] Component test: `ProtectedRoute` redirects unauthenticated users to `/login?next=` and renders children when authenticated, with a loading state while `AuthProvider` resolves, in `client/tests/components/ProtectedRoute.test.tsx`
- [X] T032 [P] [US2] Component test: `LoginPage` renders a keyboard-operable "Sign in with Google" link to `/api/auth/google/start?next=` and announces `?error` via an `aria-live` region (WCAG AA) in `client/tests/components/LoginPage.test.tsx`
- [X] T033 [P] [US2] E2E protection spec (no session seeded): visiting `/` redirects to `/login`, and a direct `GET /api/note` returns 401, in `e2e/auth-protection.spec.ts`

### Implementation for User Story 2

- [X] T034 [US2] `LoginPage` (semantic, accessible Google sign-in control carrying `next`; error from `?error`) in `client/src/pages/LoginPage.tsx` (satisfies T032)
- [X] T035 [US2] `ProtectedRoute` (redirect to `/login?next=<path>` when unauthenticated; loading while resolving) in `client/src/auth/ProtectedRoute.tsx` (satisfies T031, depends on T022)
- [X] T036 [US2] App routes — public `/login`, protected note route wrapped by `ProtectedRoute`, and post-login return to `next` — in `client/src/App.tsx` (depends on T034, T035)
- [X] T037 [US2] Update authenticated e2e specs to seed a session via `e2e/support/auth.ts` and add a sign-in happy-path in `e2e/note-save.spec.ts`, `e2e/note-view.spec.ts`, `e2e/auth.spec.ts` (satisfies sibling of T033)

**Checkpoint**: UI pages are gated; deep links redirect and return correctly; login page is accessible.

---

## Phase 5: User Story 3 - Protected endpoints require a valid access token (Priority: P1)

**Goal**: Every `/api/note` request requires a valid access token (FR-005–007); independent of the
UI via the test-login seam.

**Independent Test**: `GET`/`PUT /api/note` return 401 with no/invalid/expired token and 200 with a
valid (test-login) session.

### Tests for User Story 3 (write first, must fail)

- [X] T038 [P] [US3] Contract test: `GET`/`PUT /api/note` return 401 (`{error:"UNAUTHORIZED"}`) without a token and 200 with one, vs `contracts/openapi.yaml`, in `server/tests/contract/note-auth.test.ts`
- [X] T039 [P] [US3] Integration test: `/api/note` guarded — no token / invalid / expired → 401; valid → existing behavior — in `server/tests/integration/note-protected.test.ts`

### Implementation for User Story 3

- [X] T040 [US3] Mount `requireAuth` on the `/api/note` router in `server/src/app.ts` (depends on T016) — satisfies T038, T039
- [X] T041 [US3] Update existing note integration/contract tests to present a valid session and assert the new 401 paths in `server/tests/integration/get-note.test.ts`, `server/tests/integration/put-note.test.ts`, `server/tests/contract/get-note.test.ts`, `server/tests/contract/put-note.test.ts`

**Checkpoint**: The data is protected at the API layer regardless of the client.

---

## Phase 6: User Story 4 - Sign out (Priority: P2)

**Goal**: An authenticated user can sign out, ending the session (FR-012, SC-006).

**Independent Test**: After signing in (seeded), signing out clears cookies, deletes the session,
and a subsequent visit to `/` redirects to `/login` / `GET /api/note` returns 401.

### Tests for User Story 4 (write first, must fail)

- [X] T042 [P] [US4] Integration test: `POST /api/auth/logout` deletes the session row, clears both cookies, is idempotent (204), and subsequent `/api/note` → 401, in `server/tests/integration/logout.test.ts`
- [X] T043 [P] [US4] E2E: signed-in (seeded) user signs out and is returned to `/login`; protected content no longer reachable, in `e2e/auth.spec.ts`

### Implementation for User Story 4

- [X] T044 [US4] Implement `POST /api/auth/logout` (delete session via session-repo, clear cookies, idempotent 204) in `server/src/auth/routes.ts` (satisfies T042, depends on T014, T015)
- [X] T045 [US4] Wire client `signOut` (`POST /api/auth/logout` through the http wrapper, clear auth state, redirect to `/login`) in `client/src/auth/AuthProvider.tsx` and add an accessible "Sign out" control to the note page in `client/src/App.tsx` (satisfies T043)

**Checkpoint**: Full authentication lifecycle complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, accessibility, and gate verification across stories.

- [X] T046 [P] Unit test: env loader refuses to boot when a required variable is missing, in `server/tests/unit/env.test.ts`
- [X] T047 [P] Sweep expired sessions on startup (`sweepExpired`) in `server/src/server.ts`
- [X] T048 Review all auth code paths to ensure tokens/secrets are never logged and error bodies use the stable `{error,message}` shape, in `server/src/auth/*`
- [X] T049 [P] Accessibility verification for `LoginPage` (keyboard reach/activate, visible focus, WCAG AA contrast, `aria-live` errors) asserted in `client/tests/components/LoginPage.test.tsx`
- [X] T050 [P] Update `specs/002-google-sso-auth/quickstart.md` if any command/env changed, then run its validation steps
- [X] T051 Run full merge gates: `npm run typecheck && npm test && npm run test:e2e` and fix any failures
- [X] T052 Verify shared types have no drift: re-run `npm run gen:api` and confirm `shared/src/api.ts` is unchanged

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**.
- **User Stories (Phases 3–6)**: all depend on Foundational. Given the shared auth machinery,
  recommended order is US1 → US2 → US3 → US4 by priority, but with the test-login seam (T019),
  **US3 and US4 can proceed in parallel with US2** once Foundational is done.
- **Polish (Phase 7)**: depends on all targeted stories.

### Story-level notes

- **US1 (sign-in)** is the MVP slice — it makes the real session real.
- **US3 (endpoint protection)** is independently testable without US1/US2 via the test-login seam.
- **US2 (page protection)** needs the client foundation (T021–T023) and US1's start route target.
- **US4 (sign out)** needs the session machinery (foundational) only.

### Within each story

- Tests are written first and must FAIL before implementation.
- Models/repos → utilities → endpoints → client wiring.

---

## Parallel Opportunities

- **Setup**: T002, T003, T005 in parallel (T004 after T003).
- **Foundational tests**: T008, T009, T010, T011 together; client T021 alongside server work.
- **Foundational impl**: T013 (user-repo) parallel with T012 (tokens); T020 parallel once routes exist.
- **Per story**: all `[P]` test tasks within a story run together (e.g. T025+T026+T027; T031+T032+T033).
- **Across stories**: after Foundational, US3 (T038–T041) and US4 (T042–T045) can run while US2 (T031–T037) proceeds.

### Parallel Example: Foundational tests

```bash
Task: "Unit tests for token utilities in server/tests/unit/tokens.test.ts"
Task: "Unit tests for session-repo in server/tests/unit/session-repo.test.ts"
Task: "Integration test for requireAuth in server/tests/integration/require-auth.test.ts"
Task: "Integration test for /auth/me + /auth/refresh in server/tests/integration/auth-session.test.ts"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1).
2. **STOP and VALIDATE**: a user can sign in with Google (Google mocked in tests; real client id locally) and a session is established.
3. This is the smallest demoable increment of "the app has Google SSO."

### Incremental Delivery

1. Setup + Foundational → machinery ready (sessions, guard, test seam).
2. US1 → real sign-in (MVP).
3. US2 → protected pages + login UI.
4. US3 → protected endpoints (independently testable any time after Foundational).
5. US4 → sign out.
6. Polish → a11y, hardening, gates green.

### Notes

- `[P]` = different files, no incomplete dependencies.
- The test-login seam (T019) is the key enabler for testing protected flows without automating
  Google — see `research.md` D6. It is never mounted in production.
- Commit after each task or logical group; keep PRs sliced by story per Constitution V.
- Merge gate: tests pass, `tsc` passes, login UI meets the accessibility baseline.
