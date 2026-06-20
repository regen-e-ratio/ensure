---

description: "Task list for Release & Secure One-Time Delivery"
---

# Tasks: Release & Secure One-Time Delivery

**Input**: Design documents from `/specs/010-release-delivery/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/release-api.md, quickstart.md

**Tests**: MANDATORY (Constitution Principle I — TDD, NON-NEGOTIABLE). Each story's tests are written
before/alongside its implementation and must pass in CI before merge. **Every server/e2e test keeps
`DEADMAN_TICK_DISABLED=1`** (carried over from features 008/009) so the in-process timer never runs; the
engine is driven explicitly via `runDeadmanTick` / the `DEADMAN_TEST_MODE` fast-forward seam. The raw
grant token and note plaintext MUST NOT appear in any test fixture, log, event, or persisted
release/grant row — only the SHA-256 hash and the existing `note.ciphertext` are persisted (FR-012,
FR-017, SC-008).

**Organization**: Tasks are grouped by user story. The shared backbone (contract, `released` event enum,
the grant TTL, the two tables + index, the shared token helper, the release repo, the release-email
builder, the public-router + rate-limiter mount) lives in Setup/Foundational; each story then adds its
engine/route/UI increment — all independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (fire → release+grants+emails, idempotent), US2 (open link once / view-once / fail-closed),
  US3 (test-release preview), US4 (public view-once page)
- Exact file paths are included in every task

## Path Conventions

Web-app npm workspaces: `server/src`, `server/tests`, `client/src`, `client/tests`, `shared/src`,
`contracts/`, `e2e/` — per plan.md Structure Decision. Release work extends the existing dead-man slice;
the shared token helper + release glue live under `server/src/deadman/`, the repo under `server/src/db/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Contract, shared TTL, and generated types in place before any code consumes them.

- [ ] T001 [P] Add `RELEASE_GRANT_TTL_SECONDS` (2_592_000 = 30 days) to `shared/src/constants.ts` and re-export it from `shared/src/index.ts`
- [ ] T002 In `contracts/openapi.yaml`: add the **public** `GET /release/{token}` path (no `security`, `token` path param) returning a `ReleaseView` (`{ note: string }`) on first open with `410` (gone — viewed/expired), `404` (unknown), and `500` (decrypt failure) responses; add the **authed** `POST /deadman/test-release` path (`sessionCookie`) returning a `TestReleaseResult` (e.g. `{ grants: number }`) with `401` and a 4xx no-verified-contact error; **extend** the `DeadmanEvent` `type` enum with `released`; mirror the Note/Contact/DeadmanEvent style (per `contracts/release-api.md`)
- [ ] T003 Run `npm run gen:api` to regenerate `shared/src/api.ts` from the updated `contracts/openapi.yaml` (depends on T002)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The two tables + index, the shared token helper, the release repo, the verified-contact
lister, the release-email builder, the rate limiter, and the public-router mount that ALL stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Add the `release` (`id`, `user_id`, `trigger`, `created_at`) and `release_grant` (`id`, `release_id`, `user_id`, `contact_id`, `token_hash` UNIQUE, `expires_at`, `viewed_at`, `email_status` default `'pending'`, `provider_message_id`, `email_error`, `created_at`) tables plus `idx_release_grant_token` on `token_hash` to `openDb()` in `server/src/db/index.ts`, expressed idempotently (CREATE TABLE/INDEX IF NOT EXISTS); wipe both in the test-reset path (extend `clearDeadman` or add `clearReleases`) (per data-model.md / roadmap §3)
- [ ] T005 [P] Create `server/src/deadman/tokens.ts` — `mintToken()` (high-entropy `randomBytes(32).toString("base64url")`), `hashToken(token)` (SHA-256 hex), and `compareToken(a, b)` (constant-time via `timingSafeEqual`), mirroring `server/src/auth/tokens.ts`; **shared with feature 011**; the raw token is returned once and never stored (FR-012)
- [ ] T006 [P] Create `server/src/deadman/release-email.ts` — `buildReleaseEmail(appBaseUrl, token, recipient)` returning `{ subject, body }` whose body explains a message awaits the recipient and contains a single `${appBaseUrl}/r/${token}` link; carries no note plaintext beyond the one-time link, suitable for the generic `notify()` dispatcher (FR-002)
- [ ] T007 [P] Add `listVerifiedContacts(db, userId)` (rows WHERE `user_id = ?` AND `verified_at IS NOT NULL`) to `server/src/db/contact-repo.ts` for the verified-only snapshot (FR-001, SC-003)
- [ ] T008 Create `server/src/db/release-repo.ts`: `createRelease(db, userId, trigger, now)`, `createGrants(db, releaseId, userId, contacts, tokenHashes, expiresAt, now)` (one grant per snapshotted verified contact, stores only the hash), `getGrantByTokenHash(db, tokenHash)` (public lookup, returns owner id + viewed_at + expires_at + note-owner), `markGrantViewed(db, grantId, now)` (single-use — sets `viewed_at` only when null), `setGrantEmailStatus(db, grantId, status, providerMessageId?, error?)`, and `hasReleaseForCurrentCycle(db, userId)` (idempotency guard) — never persists a raw token or any plaintext (depends on T003, T004)
- [ ] T009 [P] Create `server/src/middleware/rate-limit.ts` — a tiny in-process fixed-window limiter (no dependency) returning an Express middleware that throttles a key (e.g. client IP) over a window, for the public release route (FR-011)
- [ ] T010 Mount the **public** release router in `server/src/app.ts`: create `createReleaseRouter(db, { keyring, now })`, apply the rate-limit middleware, and mount it at `app.use("/api/release", createReleaseRouter(...))` **before** the `requireAuth`-gated mounts (token-only authority, like the public auth callbacks and the 009 verify route); pass the keyring (`options.encryption`) into it (depends on T004)

**Checkpoint**: The two tables + index exist, the shared token helper + release-email builder + release
repo + verified-contact lister + rate limiter exist, and the public release router is mounted — user
stories can begin.

---

## Phase 3: User Story 1 - A fired switch releases the note to verified contacts (Priority: P1) 🎯 MVP

**Goal**: On grace-expiry the engine creates a release, snapshots verified contacts only, mints a grant
per contact, emails each a tokenized link, records `email_status`, transitions to `triggered`, records
`triggered` + `released`, and is idempotent (no second release on re-tick).

**Independent Test**: Arm a switch for a user with one verified + one unverified contact, drive the
engine past the grace deadline (injected clock) → assert one `release`, exactly one `release_grant` (the
verified contact), a tokenized `APP_BASE_URL/r/<token>` email sent via a **spy notifier**, `email_status`
`sent`, state `triggered`, and `triggered`+`released` events; re-tick → no second release/grant.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [ ] T011 [P] [US1] Token-helper unit tests for `mintToken`/`hashToken`/`compareToken` (entropy/length, deterministic SHA-256, distinct tokens → distinct hashes, constant-time compare true/false; raw token never equals its stored hash) in `server/tests/unit/deadman-tokens.test.ts`
- [ ] T012 [P] [US1] Release-repo unit tests: `createRelease` inserts a row; `createGrants` mints one grant per **verified** contact (stores hash, not the raw token) and none for unverified; `getGrantByTokenHash` returns the grant by hash; `setGrantEmailStatus` updates status/provider id/error; `hasReleaseForCurrentCycle` is false before / true after — in `server/tests/unit/release-repo.test.ts`
- [ ] T013 [P] [US1] Engine unit test: driving `runDeadmanTick` past a grace deadline creates one release, one grant per verified contact only, sends a tokenized link via a **spy notifier**, sets `email_status` `sent`, transitions to `triggered`, and records `triggered`+`released` (detail carries a grant count, never plaintext/token) — in `server/tests/unit/engine-release.test.ts`
- [ ] T014 [P] [US1] Engine idempotency unit test: a **second** `runDeadmanTick` (and a concurrent external-cron-style call) for an already-triggered switch creates **no** second release and **no** additional grants (guarded on state + `hasReleaseForCurrentCycle`); a per-grant email failure is recorded `failed` without aborting the release — appended to `server/tests/unit/engine-release.test.ts`

### Implementation for User Story 1

- [ ] T015 [US1] Extend the engine `Deps` + `buildDeadmanDeps` in `server/src/deadman/deps.ts`: inject the keyring, `appBaseUrl`, a `listVerifiedContacts` resolver, and a per-grant `sendReleaseEmail` (via `notify()` returning a provider message id / throwing on failure) so the engine stays unit-testable with spies (depends on T005, T006, T007)
- [ ] T016 [US1] Extend `trigger()` in `server/src/deadman/engine.ts`: guard on state + `hasReleaseForCurrentCycle` (idempotent — FR-005); `createRelease(trigger:"schedule")`, snapshot `listVerifiedContacts`, `mintToken` + `hashToken` per contact, `createGrants` with `expires_at = now + RELEASE_GRANT_TTL_SECONDS`, send each `buildReleaseEmail` via the injected notifier catching per-grant failures into `setGrantEmailStatus("failed", …)` (others continue), `setState("triggered")`, and `recordEvent("triggered")` + `recordEvent("released", { grants })` (no plaintext/token) (depends on T008, T015)
- [ ] T017 [US1] Wire the extended deps through the boot path + CLI: pass the keyring + `appBaseUrl` + email provider into `buildDeadmanDeps` in `server/src/server.ts` and `server/src/cli/deadman-tick.ts`, and into the `createDeadmanFastForwardHandler` deps in `server/src/app.ts` (so the e2e seam fires real releases) (depends on T015)

**Checkpoint**: A fired switch releases to verified contacts exactly once and is idempotent — US1
independently testable; this is the core delivery the roadmap's definition of done needs.

---

## Phase 4: User Story 2 - A contact opens the link once to read the note (Priority: P1)

**Goal**: The public `GET /api/release/{token}` returns the decrypted note exactly once for a valid,
unviewed, unexpired grant; `410 Gone` on second/expired; generic not-available on unknown; `500`
fail-closed (and `viewed_at` unset) on decrypt failure; rate-limited.

**Independent Test**: Create a grant (US1 flow or repo); `GET /api/release/{token}` → note returned once
and `viewed_at` set; call again → `410`; advance past `expires_at` → `410`; force a decrypt failure
(retire the key version) → `500`, no plaintext, `viewed_at` unset; hammer the route → rate-limited.

### Tests for User Story 2 ⚠️ (write first, ensure they FAIL)

- [ ] T018 [P] [US2] Contract test for the public `GET /api/release/{token}` happy path — a valid, unviewed, unexpired grant → `200` with the decrypted note text, and `viewed_at` is set (the test mints a grant via the US1 flow or repo) — in `server/tests/contract/release-public.test.ts`
- [ ] T019 [P] [US2] Contract tests for the failure/view-once paths — second open → `410 Gone` (no content); expired grant (`expires_at` in the past) → `410`; missing/malformed/unknown token → generic not-available (`404`/`410`) disclosing nothing; **decrypt failure → `500` with no plaintext and `viewed_at` NOT set** (retryable); rate-limit: excessive requests are throttled — appended to `server/tests/contract/release-public.test.ts`

### Implementation for User Story 2

- [ ] T020 [US2] Add the `{token}` path-param parser to `server/src/validation/release.ts` (presence/shape; missing/malformed → generic not-available)
- [ ] T021 [US2] Implement `createReleaseRouter(db, { keyring, now })` `GET /:token` in `server/src/routes/release.ts` — parse token, `hashToken`, `getGrantByTokenHash`; if found AND `viewed_at == null` AND `now < expires_at`: decrypt the owner's note via the keyring/`note-repo` (fail-closed — on `NoteDecryptError` return `500`, do NOT set `viewed_at`), then `markGrantViewed(now)` and return `{ note }` **once**; else `410 Gone`; unknown/malformed → generic not-available; never log the token or plaintext (depends on T008, T010, T020)
- [ ] T022 [US2] Confirm the rate-limit middleware is applied to the public release route in `server/src/app.ts` and tuned so a normal single open passes while a burst is throttled (depends on T009, T010)

**Checkpoint**: A contact can read the note exactly once; replay/expired → 410; decrypt failure →
fail-closed 500; the route is rate-limited — the security core is provable. US1+US2 independently
functional.

---

## Phase 5: User Story 3 - Preview the recipient experience without triggering (Priority: P2)

**Goal**: An authed `POST /api/deadman/test-release` creates a `manual_test` release + grant(s) to the
owner's own verified address, emails the tokenized link, and leaves switch state unchanged.

**Independent Test**: As a signed-in user with a verified contact, `POST /api/deadman/test-release` →
assert a `manual_test` release + grant to the owner's own verified address, a tokenized email via the
**spy notifier**, and switch state **unchanged**; open the link once → note renders; `401` unauth; no
verified contact → clear error, no email.

### Tests for User Story 3 ⚠️ (write first, ensure they FAIL)

- [ ] T023 [P] [US3] Contract test for `POST /api/deadman/test-release` — signed-in with a verified contact → `200`, a `manual_test` release + grant(s) to the owner's own verified address are created, a tokenized link email is sent via a **spy notifier**, and the switch state is **unchanged** before/after; no-cookie → `401`; no verified contact → 4xx error with no email — in `server/tests/contract/deadman-test-release.test.ts`
- [ ] T024 [P] [US3] Unit test for `runTestRelease` — creates a `manual_test` release, snapshots the caller's own verified contacts, mints grants, sends via the injected notifier, and does NOT call `setState` (state untouched) — in `server/tests/unit/test-release.test.ts`

### Implementation for User Story 3

- [ ] T025 [US3] Create `server/src/deadman/test-release.ts` — `runTestRelease(db, deps, userId, now)`: snapshot the caller's own `listVerifiedContacts`, `createRelease(trigger:"manual_test")`, mint+hash a grant per contact, `createGrants`, send each `buildReleaseEmail` via the injected notifier with `setGrantEmailStatus`, and return the grant count; **never** touches switch state (depends on T008, T015)
- [ ] T026 [US3] Add the authed `POST /test-release` handler to the deadman router in `server/src/routes/deadman.ts` — scoped to `req.user.id`; if the caller has no verified contact return a clear 4xx error with no email; else `runTestRelease(...)` and return `{ grants }`; pass the release deps (keyring/appBaseUrl/emailProvider) into `createDeadmanRouter` and wire them in `server/src/app.ts` + `server/src/server.ts` (depends on T025)

**Checkpoint**: A user can preview exactly what their contacts will receive without firing the switch —
US1–US3 independently functional; this is the CTA feature 012 integrates.

---

## Phase 6: User Story 4 - The public view-once recipient page (Priority: P1)

**Goal**: A public `/r/:token` page warns the note can be opened only once, renders the note text on a
valid open, shows a clear "no longer available" message for expired/viewed links, and a generic error on
failure — accessible and reachable without a session.

**Independent Test**: Render `ReleaseViewPage` with a token that resolves to a note → assert the
single-use warning + note text; render with an already-viewed/expired token → "no longer available";
render with a server error → generic error; assert keyboard reachability + semantic/live-region markup,
no colour-only signalling, reachable without a session.

### Tests for User Story 4 ⚠️ (write first, ensure they FAIL)

- [ ] T027 [P] [US4] Client page test: `ReleaseViewPage` reads `:token`, calls the open-once client, and renders (a) a prominent "this can only be opened once" warning + the note text on success, (b) a clear "no longer available" message on `410`, and (c) a generic error otherwise — with semantic, keyboard-accessible markup (`role="status"`/`role="alert"`, no colour-only) — in `client/tests/pages/ReleaseViewPage.test.tsx`

### Implementation for User Story 4

- [ ] T028 [P] [US4] Create `client/src/api/releaseClient.ts` — `openRelease(token)` calling `apiFetch` for the public `GET /api/release/{token}`, mapping `200` → `{ note }`, `410` → gone, others → error (the public route needs no silent-refresh) (depends on T003)
- [ ] T029 [US4] Create `client/src/pages/ReleaseViewPage.tsx` (public): read the `:token` route param, call `openRelease(token)` on mount (guard React 18 StrictMode double-effect so the single-use token is not burned twice, mirroring `ContactVerifiedPage`), and render the warning + note / no-longer-available / error with a semantic heading + `role="status"`/`role="alert"`; register a **public** route `/r/:token` in `client/src/App.tsx` **outside** `ProtectedRoute` (depends on T028)
- [ ] T030 [P] [US4] Add the view-once warning + note CSS classes (WCAG AA contrast, text-labelled, not colour-only, focus states) to `client/src/styles.css`
- [ ] T031 [P] [US4] Add `testRelease()` (authed `POST /api/deadman/test-release`) to `client/src/api/deadmanClient.ts` using `apiFetch`, surfacing the server `message` on non-OK (consumed by feature 012's preview CTA) (depends on T003)

**Checkpoint**: Recipients see a clear, accessible view-once page; the owner has a `testRelease()` client
call to preview. US1–US4 independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Cross-cutting isolation, end-to-end coverage, no-leak assertions, docs, and quality gates.

- [ ] T032 [P] Cross-cutting assertion: grep/inspect that the raw grant token and note plaintext never appear in any log line, event detail, or persisted release/grant row across the suite (only the SHA-256 hash + the existing ciphertext are persisted) — assert within `server/tests/contract/release-public.test.ts` / `server/tests/unit/engine-release.test.ts` (FR-012, FR-017, SC-008)
- [ ] T033 Create `e2e/release-delivery.spec.ts` (Playwright): `loginAs` → write a note → add + verify a contact (capturing-email link) → arm the switch → `POST /api/test/deadman` (DEADMAN_TEST_MODE fast-forward) to miss the deadline → grace → trigger → read the release link from the captured stub email → open `/r/<token>` once and assert the note + single-use warning → reload and assert "no longer available" (410) — keeping `DEADMAN_TICK_DISABLED=1`
- [ ] T034 Update `README.md`: **Architecture** (the `release` + `release_grant` tables, the engine trigger→release flow snapshotting verified contacts, the public `GET /api/release/{token}` one-time decrypt via the keyring with fail-closed/410/rate-limit, the authed `POST /api/deadman/test-release` preview) and **Tests** (the new release test files) — in the same commits as the code slices; **Run** and **Manual setup** unchanged (no new env var or external service) (per CLAUDE.md README policy)
- [ ] T035 [P] Run the full gates and quickstart validation: `npm run typecheck`, `npm test`, `npm run test:e2e`, and the manual steps in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 [P] is independent; T002 → T003 (gen:api needs the updated contract).
- **Foundational (Phase 2)**: Depends on Setup (generated types + TTL). BLOCKS all stories. T004 (tables)
  precedes the repo work; T005/T006/T007/T009 are [P] (different files); T008 waits on T003+T004; T010
  waits on T004.
- **User Stories (Phase 3–6)**: All depend on Foundational. Implemented in priority order
  (US1 → US2 → US3 → US4). US2/US3 grow the same shared files (`engine.ts`, `deps.ts`, `release-repo.ts`,
  `routes/deadman.ts`, `app.ts`), so cross-story edits to those files are **sequential by design**, not
  parallel; US4 (client) is largely independent of the server stories once the contract (T003) exists.
- **Polish (Phase 7)**: T032 after the engine + public route; T033 after the full server + client path;
  T034/T035 last.

### Within Each User Story

- Tests (the `### Tests` block) are written first and must FAIL before implementation.
- Token/email helpers + the repo (Foundational) before the engine trigger; the engine + repo before the
  public route; the route before the client API; the client API before the page.
- US1 must precede US2/US3 only because they extend the same shared server files; each story remains
  independently testable at its checkpoint.

### Parallel Opportunities

- T001 runs alongside T002.
- Foundational: T005, T006, T007, T009 are [P] (different files); T008 waits on T004; T010 waits on T004.
- Each story's `### Tests` tasks ([P]) run together (distinct files), as can the client-API/CSS tasks
  marked [P] (T028, T030, T031).
- T032, T035 are [P] relative to each other.

---

## Parallel Example: User Story 1

```bash
# Write US1 tests together first (distinct files):
Task: "Token-helper unit tests in server/tests/unit/deadman-tokens.test.ts"          # T011
Task: "Release-repo unit tests in server/tests/unit/release-repo.test.ts"            # T012
Task: "Engine release unit test in server/tests/unit/engine-release.test.ts"         # T013
Task: "Engine idempotency unit test in server/tests/unit/engine-release.test.ts"     # T014 (same file → after T013)

# Then implement (foundational helpers/repo first, in parallel where [P]):
Task: "Create server/src/deadman/tokens.ts"                                          # T005 (foundational)
Task: "Create server/src/deadman/release-email.ts"                                   # T006 (foundational)
Task: "Add listVerifiedContacts to server/src/db/contact-repo.ts"                    # T007 (foundational)
Task: "Create server/src/db/release-repo.ts"                                         # T008 (foundational)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & VALIDATE**: a fired switch creates
   a release, snapshots verified contacts, mints grants, emails tokenized links, transitions to
   `triggered`, and is idempotent (the core delivery). Deploy/demo.

### Incremental Delivery (matches plan.md PR slices)

1. Setup + Foundational + US1 → MVP (fire → release + verified-only grants + emails, idempotent).
2. US2 (public open-once: decrypt-once, 410, fail-closed 500, rate-limit) → contract tests green → demo.
3. US3 (test-release preview, state unchanged) → contract test green → demo.
4. US4 (public `/r/:token` view-once page + `releaseClient` + `testRelease()`) → page test green → demo.
5. Polish (no-leak assertion, full e2e cycle, README, gates).

Each story adds value without breaking the previous; commit after each task or logical group as its own
bisectable `feat:` commit.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- Shared files (`engine.ts`, `deps.ts`, `release-repo.ts`, `routes/deadman.ts`, `app.ts`) are
  intentionally grown across stories in priority order — that's why those impl tasks are NOT marked [P]
  across phases.
- The **public** open endpoint is token-only authority + **fail-closed** (viewed/expired → `410`,
  unknown/malformed → generic not-available, decrypt failure → `500` with `viewed_at` unset) and
  **rate-limited**; the **test-release** endpoint is authed + scoped by `req.user.id` and never changes
  switch state.
- The grant token reuses the existing SHA-256 hashed-token pattern via the shared `deadman/tokens.ts`
  (also used by feature 011): shown once in the `/r/<token>` link, only the hash stored; the raw token
  never appears in a log, event, or response (FR-012, SC-008).
- Release creation is **idempotent** (state + `hasReleaseForCurrentCycle`), so the in-process timer and an
  external cron never double-release (FR-005, SC-002).
- Only **verified** contacts (`verified_at != null`) are snapshotted; unverified contacts get no grant
  (FR-001, SC-003).
- The note is decrypted server-side via the existing keyring + `note-repo` fail-closed path, only on a
  valid open, and the plaintext is never persisted outside `note.ciphertext`, never logged, never in an
  event (FR-008, FR-010, FR-017, SC-008).
- Emails are sent only through the generic `notify()` dispatcher (email channel); the body carries a
  single `APP_BASE_URL/r/<token>` link and no plaintext (FR-002).
- This feature adds endpoints + two tables + a page but **no new env var or external service** (it reuses
  `APP_BASE_URL`, the email channel, and the keyring), so only the README **Architecture** and **Tests**
  sections change (T034).
- Verify each story's tests fail before implementing it.
```
