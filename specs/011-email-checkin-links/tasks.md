---

description: "Task list for Passwordless Email Check-In Links"
---

# Tasks: Passwordless Email Check-In Links

**Input**: Design documents from `/specs/011-email-checkin-links/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/checkin-api.md, quickstart.md

**Tests**: MANDATORY (Constitution Principle I — TDD, NON-NEGOTIABLE). Each story's tests are written
before/alongside its implementation and must pass in CI before merge. **Every server/e2e test keeps
`DEADMAN_TICK_DISABLED=1`** (carried over from features 008/009/010) so the in-process timer never runs;
the engine is driven explicitly via `runDeadmanTick` / the `DEADMAN_TEST_MODE` fast-forward seam. The raw
check-in token and its hash MUST NOT appear in any test fixture, log, event, email body (beyond the single
one-time link), or response — only the SHA-256 hash is persisted (FR-002, FR-014, SC-005).

**Organization**: Tasks are grouped by user story. The shared backbone (contract, the check-in TTL, the
`checkin_token` table + index, the checkin-token repo, the public-router mount, the engine `mintCheckinLink`
dep) lives in Setup/Foundational; each story then adds its engine/route/UI increment — all independently
testable. The token helper (`deadman/tokens.ts`) and the check-in reset (`recordCheckin` + `checkin`
event) are **reused** from features 010/008 (no new module, no new reset path).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (passwordless check-in resets the clock), US2 (token lifecycle: used/expired/invalid →
  fail closed), US3 (reminder email carries a working link), US4 (public confirmation page)
- Exact file paths are included in every task

## Path Conventions

Web-app npm workspaces: `server/src`, `server/tests`, `client/src`, `client/tests`, `shared/src`,
`contracts/`, `e2e/` — per plan.md Structure Decision. Check-in work extends the existing dead-man slice;
the checkin-token repo lives under `server/src/db/`, the link mint + reminder change under
`server/src/deadman/`, and the public route under `server/src/routes/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Contract, shared TTL, and generated types in place before any code consumes them.

- [ ] T001 [P] Add `CHECKIN_TOKEN_TTL_SECONDS` (bounded so a link can't outlive its usefulness — aligned to the grace window, e.g. `DEADMAN_DEFAULT_GRACE_SECONDS`) to `shared/src/constants.ts` and re-export it from `shared/src/index.ts`
- [ ] T002 In `contracts/openapi.yaml`: add the **public** `GET /deadman/checkin` path (no `security`, a required `token` query param) returning a `CheckinLinkResult` (`{ status: "checked_in" | "not_available" }`) on `200` for both the success and the generic not-available outcomes (a non-disclosing single shape; reserve `Error`/4xx only for malformed-request shape if needed) — mirroring the public `GET /contact/verify` style; add the `CheckinLinkResult` schema (per `contracts/checkin-api.md`)
- [ ] T003 Run `npm run gen:api` to regenerate `shared/src/api.ts` from the updated `contracts/openapi.yaml` (depends on T002)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `checkin_token` table + index, the checkin-token repo, the engine `mintCheckinLink` dep,
and the public-router mount that ALL stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Add the `checkin_token` (`id`, `user_id`, `token_hash` UNIQUE, `expires_at`, `used_at`, `created_at`) table plus `idx_checkin_token_hash` on `token_hash` to `openDb()` in `server/src/db/index.ts`, expressed idempotently (CREATE TABLE/INDEX IF NOT EXISTS); wipe it in the test-reset path by extending `clearDeadman` in `server/src/db/config-repo.ts` (delete `checkin_token`) (per data-model.md / roadmap §3)
- [ ] T005 [P] Create `server/src/db/checkin-token-repo.ts` — `createCheckinToken(db, userId, tokenHash, expiresAt, now)` (stores only the hash), `findByTokenHash(db, tokenHash)` (→ `{ id, userId, usedAt, expiresAt }` or null), `markUsed(db, id, now)` (single-use — sets `used_at` only when null, returns whether THIS call consumed it), and `clearCheckinTokens(db)` — never persists a raw token (FR-002, FR-013)
- [ ] T006 [P] Create `server/src/deadman/checkin-link.ts` — `buildCheckinLink(appBaseUrl, token)` returning the absolute `${appBaseUrl}/checkin?token=${token}` URL (single source of the link shape, shared by the engine dep and test assertions) (FR-001)
- [ ] T007 [P] Add the `token` query-param parser to `server/src/validation/checkin.ts` (presence/shape: non-empty base64url string, bounded length; missing/malformed → the generic not-available path), mirroring `validation/release.ts` (FR-006)
- [ ] T008 Mount the **public** check-in router in `server/src/app.ts`: create `createCheckinRouter(db, { now })` and mount it at `app.use("/api/deadman/checkin", createCheckinRouter(...))` **before** the `requireAuth`-gated `/api/deadman` mount (token-only authority, like the 009 contact-verify and 010 release public routes) (depends on T004)

**Checkpoint**: The `checkin_token` table + index exist, the repo + link builder + token parser exist, and
the public check-in router is mounted — user stories can begin.

---

## Phase 3: User Story 1 - Stay alive from the inbox (Priority: P1) 🎯 MVP

**Goal**: A valid, unused, unexpired check-in token opened against the public `GET /api/deadman/checkin`
resets the clock — switch back to `active`, `next_checkin_due_at` reset, grace bookkeeping cleared, a
`checkin` event recorded, the token marked used — with no sign-in.

**Independent Test**: Mint a check-in token for a user whose switch is in `grace` (via the repo), call
`GET /api/deadman/checkin?token=<raw>` → assert state `active`, `next_checkin_due_at` reset to now +
interval, `grace_deadline_at`/`reminders_sent` cleared, a `checkin` event recorded, `used_at` set, and a
`{ status: "checked_in" }` confirmation.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [ ] T009 [P] [US1] Checkin-token-repo unit tests: `createCheckinToken` stores the **hash** (not the raw token) with the given `expires_at`; `findByTokenHash` returns the row by hash (and null for an unknown hash); `markUsed` sets `used_at` once → returns true, a second call → returns false (single-use); the raw token never equals its stored hash — in `server/tests/unit/checkin-token-repo.test.ts`
- [ ] T010 [P] [US1] Contract test for the public `GET /api/deadman/checkin` happy path — a `grace` switch + a valid/unused/unexpired token → `200 { status: "checked_in" }`, state is now `active`, `next_checkin_due_at` is reset, `grace_deadline_at`/`reminders_sent` cleared, a `checkin` event is recorded, and `used_at` is set; also assert an `active` switch (early open) still checks in — in `server/tests/contract/deadman-checkin-public.test.ts`

### Implementation for User Story 1

- [ ] T011 [US1] Implement `createCheckinRouter(db, { now })` `GET /` in `server/src/routes/deadman-checkin.ts` — parse the `token` query param (malformed → `{ status: "not_available" }`), `hashToken`, `findByTokenHash`; if found AND `used_at == null` AND `now < expires_at` AND the switch (`getConfig`) is `active`/`grace`: `recordCheckin(db, userId, now)` + `recordEvent(db, userId, "checkin", { nextCheckinDueAt }, now)`, then `markUsed` (only proceed if it consumed the token) and return `{ status: "checked_in" }`; never log the token (depends on T004, T005, T007, T008)
- [ ] T012 [US1] Confirm the check-in reuses feature 008's existing `recordCheckin` + `checkin` event unchanged (no new reset path, no new event type) — assert in `server/tests/contract/deadman-checkin-public.test.ts` that the resulting state matches an authed dashboard check-in (depends on T011)

**Checkpoint**: A valid reminder link checks the user in from the inbox — US1 independently testable; this
is the core value the roadmap's definition of done needs ("check in from … an email link").

---

## Phase 4: User Story 2 - Token lifecycle: expired, used, and invalid links (Priority: P1)

**Goal**: The public `GET /api/deadman/checkin` fails closed and non-disclosing — used/expired/unknown/
malformed tokens, and tokens whose switch is `triggered`/`disarmed`, return the same generic not-available
result and never reset the clock; a non-checkable-switch token is still consumed (replay-proof).

**Independent Test**: Open a valid token once (succeeds, US1), open the **same** token again → generic
not-available, switch unchanged; advance past `expires_at` for a fresh token → not-available, `used_at`
unset; open an unknown and a malformed token → the same not-available; open a valid token whose switch is
`triggered`/`disarmed` → not-available, clock unchanged, token now used; in every failure case assert no
`checkin` event was recorded and `next_checkin_due_at` is unchanged.

### Tests for User Story 2 ⚠️ (write first, ensure they FAIL)

- [ ] T013 [P] [US2] Contract tests for the failure/single-use paths — second open of an already-used token → `{ status: "not_available" }` with the switch unchanged (no second `checkin` event); expired token (`expires_at` in the past) → not-available, `used_at` NOT set, clock unchanged; missing/malformed/unknown token → the same generic not-available — appended to `server/tests/contract/deadman-checkin-public.test.ts`
- [ ] T014 [P] [US2] Contract test for the non-checkable-switch path — a valid token whose switch is `triggered` (or `disarmed`) → `{ status: "not_available" }`, the clock is NOT reset, but the token **is** consumed (`used_at` set, so a later re-arm can't be reset by the stale link) — appended to `server/tests/contract/deadman-checkin-public.test.ts`

### Implementation for User Story 2

- [ ] T015 [US2] Harden `GET /` in `server/src/routes/deadman-checkin.ts`: collapse every failure (missing/malformed/unknown token, `used_at != null`, inclusive expiry `now >= expires_at`, switch not `active`/`grace`) to a single `{ status: "not_available" }` disclosing nothing; on the **non-checkable-switch** case, `markUsed` the token (consume without resetting the clock) so it can't be replayed; ensure `recordCheckin`/`recordEvent` run ONLY on the success path (no `checkin` event on any failure) (depends on T011)

**Checkpoint**: Replay/expired/invalid links are inert and non-disclosing; a non-checkable-switch token is
consumed but never resets the clock — the security core is provable. US1+US2 independently functional.

---

## Phase 5: User Story 3 - A reminder email carries a working check-in link (Priority: P1)

**Goal**: Each grace reminder the engine sends (first + subsequent) mints a fresh check-in token, persists
only its hash, and embeds an `APP_BASE_URL/checkin?token=<token>` link in the body — and that exact link
performs a real check-in.

**Independent Test**: Drive the engine into `grace` for a user (injected clock + spy notifier), capture the
reminder, assert its body contains exactly one `APP_BASE_URL/checkin?token=<token>` link and a
`checkin_token` row (hash only) was created; extract the raw token and `GET /api/deadman/checkin?token=` →
the switch is checked in (US1 outcome); assert each subsequent reminder mints its own fresh link and no
reminder body leaks a token hash, note plaintext, or other secret.

### Tests for User Story 3 ⚠️ (write first, ensure they FAIL)

- [ ] T016 [P] [US3] Engine reminder unit test: driving `runDeadmanTick` so an `active` switch enters grace makes the first reminder body (captured via a **spy notifier**) contain exactly one `${APP_BASE_URL}/checkin?token=<token>` link backed by a new `checkin_token` row (hash stored, future `expires_at`); a subsequent `sendReminder` (still under the cap) mints a **fresh** token/link; the body contains no token hash, note plaintext, or secret beyond the link — in `server/tests/unit/engine-reminder-link.test.ts`
- [ ] T017 [P] [US3] Engine reminder failure-isolation unit test: when minting/persisting a check-in token throws for one user, the tick does not abort the batch (other users still process) and no token/secret leaks into the recorded marker — appended to `server/tests/unit/engine-reminder-link.test.ts`

### Implementation for User Story 3

- [ ] T018 [US3] Extend the engine `Deps` + `buildDeadmanDeps` in `server/src/deadman/deps.ts`: add `mintCheckinLink(userId: string): string` — `mintToken()` (reuse `deadman/tokens.ts`), `hashToken`, `createCheckinToken(db, userId, hash, now + CHECKIN_TOKEN_TTL_SECONDS, now)`, and return `buildCheckinLink(appBaseUrl, token)` — kept a closure so the engine stays unit-testable with a spy (depends on T005, T006, T001)
- [ ] T019 [US3] Extend the reminder send in `server/src/deadman/engine.ts`: have `enterGrace` and `sendReminder` call `deps.mintCheckinLink(userId)` and pass the link into `buildReminder` so the reminder body embeds the `APP_BASE_URL/checkin?token=<token>` link (no secret beyond the link); keep the per-user failure isolation so a mint failure never aborts the batch (FR-008, FR-009) (depends on T018)
- [ ] T020 [US3] Wire the extended deps through the boot path + CLI + seam: `buildDeadmanDeps` already receives `db`, `emailProvider`, `appBaseUrl` in `server/src/server.ts`, `server/src/cli/deadman-tick.ts`, and the `createDeadmanFastForwardHandler` deps in `server/src/app.ts` — confirm `mintCheckinLink` is constructed there so the boot timer, the CLI tick, and the e2e seam all mint real links (depends on T018)

**Checkpoint**: The reminder the user actually receives carries a working check-in link — US1–US3
independently functional; the inbox path is wired end to end.

---

## Phase 6: User Story 4 - The public confirmation page (Priority: P2)

**Goal**: A public `/checked-in` page confirms a successful check-in (clock reset) or shows a clear
"no longer available" message for a used/expired/invalid link — accessible and reachable without a session.

**Independent Test**: Render `CheckedInPage` with a token that checks in → assert a clear "you're checked
in" confirmation via an accessible live region; render with a used/expired/invalid token → "no longer
available"; render with a server error → generic error; assert keyboard reachability + semantic/live-region
markup, no colour-only signalling, reachable without a session.

### Tests for User Story 4 ⚠️ (write first, ensure they FAIL)

- [ ] T021 [P] [US4] Client page test: `CheckedInPage` reads `?token`, calls the check-in client once, and renders (a) a prominent "you're checked in" confirmation on `checked_in`, (b) a clear "no longer available" message on `not_available`, and (c) a generic error otherwise — with semantic, keyboard-accessible markup (`role="status"`/`role="alert"`, no colour-only) and a StrictMode double-effect guard so the single-use token is not consumed twice — in `client/tests/pages/CheckedInPage.test.tsx`

### Implementation for User Story 4

- [ ] T022 [P] [US4] Create `client/src/api/checkinClient.ts` — `checkInWithToken(token)` calling `apiFetch` for the public `GET /api/deadman/checkin?token=`, mapping `{ status: "checked_in" }` → checked-in and `{ status: "not_available" }` → not-available, and a thrown `ApiError` → error (the public route needs no silent-refresh) (depends on T003)
- [ ] T023 [US4] Create `client/src/pages/CheckedInPage.tsx` (public): read the `token` query param, call `checkInWithToken(token)` on mount (guard React 18 StrictMode's double-effect with a `requestedToken` ref so the single-use token is not consumed twice, mirroring `ContactVerifiedPage`/`ReleaseViewPage`), and render the confirmation / no-longer-available / error with a semantic heading + `role="status"`/`role="alert"`; register a **public** route `/checked-in` in `client/src/App.tsx` **outside** `ProtectedRoute` (depends on T022)
- [ ] T024 [P] [US4] Add any check-in confirmation CSS to `client/src/styles.css` only if the existing `verify-result`/`release-view` classes don't suffice (WCAG AA contrast, text-labelled, not colour-only, focus states)

**Checkpoint**: A user who opens a reminder link sees a clear, accessible confirmation that they are safe
for another interval. US1–US4 independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Cross-cutting isolation, end-to-end coverage, no-leak assertions, docs, and quality gates.

- [ ] T025 [P] Cross-cutting assertion: grep/inspect that the raw check-in token and its hash never appear in any log line, event detail, email body (beyond the single one-time link), or endpoint/page response across the suite (only the SHA-256 hash is persisted) — assert within `server/tests/contract/deadman-checkin-public.test.ts` / `server/tests/unit/engine-reminder-link.test.ts` (FR-002, FR-014, SC-005)
- [ ] T026 Create `e2e/checkin-link.spec.ts` (Playwright): `loginAs` → arm the switch → `POST /api/test/deadman` (DEADMAN_TEST_MODE fast-forward) to miss the deadline → grace → read the captured reminder email's `/checkin?token=<token>` link → open it → assert the `/checked-in` page confirms the check-in → reload the dashboard and assert the state is `active` again — keeping `DEADMAN_TICK_DISABLED=1`
- [ ] T027 Update `README.md`: **Architecture** (the `checkin_token` table, the reminder→check-in-link mint, the public `GET /api/deadman/checkin` one-time clock reset reusing `recordCheckin`) and **Tests** (the new check-in test files) — in the same commits as the code slices; **Run** and **Manual setup** unchanged (no new env var or external service) (per CLAUDE.md README policy)
- [ ] T028 [P] Run the full gates and quickstart validation: `npm run typecheck`, `npm test`, `npm run test:e2e`, and the manual steps in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 [P] is independent; T002 → T003 (gen:api needs the updated contract).
- **Foundational (Phase 2)**: Depends on Setup (generated types + TTL). BLOCKS all stories. T004 (table)
  precedes the repo + mount; T005/T006/T007 are [P] (different files); T008 waits on T004.
- **User Stories (Phase 3–6)**: All depend on Foundational. Implemented in priority order
  (US1 → US2 → US3 → US4). US1/US2 grow the same public route file
  (`routes/deadman-checkin.ts`), so those impl tasks are **sequential by design**; US3 grows the engine
  (`deps.ts`, `engine.ts`); US4 (client) is largely independent of the server stories once the contract
  (T003) exists.
- **Polish (Phase 7)**: T025 after the route + engine; T026 after the full server + client path;
  T027/T028 last.

### Within Each User Story

- Tests (the `### Tests` block) are written first and must FAIL before implementation.
- The repo + token parser (Foundational) before the public route; the public route before the client API;
  the client API before the page. The engine reminder change (US3) depends on the `mintCheckinLink` dep.
- US1 must precede US2 (same route file) and US3 (same engine deps); each story remains independently
  testable at its checkpoint.

### Parallel Opportunities

- T001 runs alongside T002.
- Foundational: T005, T006, T007 are [P] (different files); T008 waits on T004.
- Each story's `### Tests` tasks ([P]) run together (distinct files), as can the client-API/CSS tasks
  marked [P] (T022, T024).
- T025, T028 are [P] relative to each other.

---

## Parallel Example: User Story 1

```bash
# Write US1 tests together first (distinct files):
Task: "Checkin-token-repo unit tests in server/tests/unit/checkin-token-repo.test.ts"        # T009
Task: "Public check-in happy-path contract test in server/tests/contract/deadman-checkin-public.test.ts" # T010

# Then implement (foundational repo/link/parser first, in parallel where [P]):
Task: "Create server/src/db/checkin-token-repo.ts"                                            # T005 (foundational)
Task: "Create server/src/deadman/checkin-link.ts"                                             # T006 (foundational)
Task: "Create server/src/validation/checkin.ts"                                               # T007 (foundational)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & VALIDATE**: a valid check-in token
   opened against the public endpoint resets the clock (switch back to `active`, `checkin` event, token
   consumed) without a sign-in (the core inbox check-in). Deploy/demo.

### Incremental Delivery (matches plan.md PR slices)

1. Setup + Foundational + US1 → MVP (public link check-in resets the clock).
2. US2 (used/expired/invalid + non-checkable-switch → fail-closed, non-disclosing, replay-proof) → contract
   tests green → demo.
3. US3 (reminder mints a fresh link per reminder; the captured link performs a real check-in) → engine
   unit tests green → demo.
4. US4 (public `/checked-in` page + `checkinClient`) → page test green → demo.
5. Polish (no-leak assertion, full e2e cycle, README, gates).

Each story adds value without breaking the previous; commit after each task or logical group as its own
bisectable `feat:` commit.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- Shared files (`routes/deadman-checkin.ts`, `deadman/engine.ts`, `deadman/deps.ts`, `app.ts`) are
  intentionally grown across stories in priority order — that's why those impl tasks are NOT marked [P]
  across phases.
- The **public** check-in endpoint is token-only authority + **fail-closed / non-disclosing**: every
  failure (used/expired/unknown/malformed/non-checkable switch) collapses to a single
  `{ status: "not_available" }`; a non-checkable-switch token is **consumed** (replay-proof) but never
  resets the clock (FR-006, FR-007).
- The check-in token reuses feature 010's SHA-256 hashed-token helper (`deadman/tokens.ts`): shown once in
  the `/checkin?token=<token>` link, only the hash stored; the raw token never appears in a log, event,
  email body (beyond the link), or response (FR-002, SC-005).
- The check-in **reuses** feature 008's `recordCheckin` reset + the existing `checkin` event — no new reset
  path and no new event type (FR-004).
- Each grace reminder mints its **own** fresh check-in token; the previous link stays valid until used/
  expired, but no link can ever over-reset or corrupt the clock (single-use + TTL).
- Reminder emails are sent only through the generic `notify()` dispatcher (email channel); the body carries
  a single `APP_BASE_URL/checkin?token=<token>` link and no secret beyond it (FR-001, FR-008).
- This feature adds one endpoint + one table + a page but **no new env var or external service** (it reuses
  `APP_BASE_URL`, the email channel, the token helper, and `recordCheckin`), so only the README
  **Architecture** and **Tests** sections change (T027).
- Verify each story's tests fail before implementing it.
