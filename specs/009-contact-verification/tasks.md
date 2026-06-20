---

description: "Task list for Contact Verification"
---

# Tasks: Contact Verification

**Input**: Design documents from `/specs/009-contact-verification/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/contact-verification-api.md, quickstart.md

**Tests**: MANDATORY (Constitution Principle I — TDD, NON-NEGOTIABLE). Each story's tests are written
before/alongside its implementation and must pass in CI before merge. **Every server/e2e test keeps
`DEADMAN_TICK_DISABLED=1`** (carried over from feature 008) so the in-process timer never runs. The raw
verification token MUST NOT appear in any test fixture, log, event, or serialized contact — only its
SHA-256 hash is persisted (FR-012, SC-006).

**Organization**: Tasks are grouped by user story. The shared backbone (contract, extended `Contact`
type, the shared TTL, the three contact columns + index, the token + repo verification helpers, the
public-router mount) lives in Setup/Foundational; each story then adds its endpoint behaviour, client
call, and UI increment — all independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (send + confirm), US2 (badge + (re)send UI), US3 (token lifecycle), US4 (idempotent re-verify / unverified default)
- Exact file paths are included in every task

## Path Conventions

Web-app npm workspaces: `server/src`, `server/tests`, `client/src`, `client/tests`, `shared/src`,
`contracts/`, `e2e/` — per plan.md Structure Decision. Verification extends the existing contact slice;
token/email helpers live in `server/src/contacts/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Contract, shared TTL, and generated types in place before any code consumes them.

- [ ] T001 [P] Add `CONTACT_VERIFICATION_TTL_SECONDS` (86_400 = 24 h) to `shared/src/constants.ts` and re-export it from `shared/src/index.ts`
- [ ] T002 In `contracts/openapi.yaml`: extend the `Contact` schema with `verified` (boolean, required, derived from `verified_at != null`) and `verifiedAt` (nullable date-time); add the `POST /contact/{id}/verify` path (authed, `sessionCookie`) returning a `ContactVerifySendResponse` (e.g. the updated `Contact` or `{ sent: true }`) with `401`/`404` responses; add the **public** `GET /contact/verify` path (no `security`) with a `token` query param returning a `ContactVerifyResult` (`{ status: "verified" | "already_verified" | "invalid_or_expired" }`); mirror the Note/Contact style (per `contracts/contact-verification-api.md`)
- [ ] T003 Run `npm run gen:api` to regenerate `shared/src/api.ts` from the updated `contracts/openapi.yaml` (depends on T002)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The three contact columns + index, the token + email helpers, the repo verification
functions, and the public-router mount that ALL stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Add `verified_at`, `verification_token_hash`, and `verification_expires_at` (all nullable `TEXT`) to the `contact` table in `openDb()` in `server/src/db/index.ts`, plus `idx_contact_verification_hash` on `verification_token_hash` (partial: `WHERE verification_token_hash IS NOT NULL`); express the additions idempotently so a fresh DB and an existing DB converge and every pre-existing row keeps a null `verified_at` (unverified by default — FR-001, per data-model.md)
- [ ] T005 [P] Create `server/src/contacts/verification-token.ts` — `mintVerificationToken()` (high-entropy `randomBytes(...).toString("base64url")`) and `hashVerificationToken(token)` (SHA-256 hex), mirroring `server/src/auth/tokens.ts`; the raw token is returned to the caller once and never stored (FR-012)
- [ ] T006 [P] Create `server/src/contacts/verification-email.ts` — `buildVerificationEmail(appBaseUrl, token, recipient)` returning `{ subject, body }` whose body contains a single `${appBaseUrl}/contact-verified?token=${token}` link; carries no secret beyond the one-time link, suitable for the generic `notify()` dispatcher (FR-004)
- [ ] T007 Extend `server/src/db/contact-repo.ts`: add `verified_at`/`verification_token_hash`/`verification_expires_at` to `ContactRow`, extend `toContact` to expose `verified` (`row.verified_at != null`) and `verifiedAt` (`row.verified_at ?? null`) — and NOT the hash/expiry; add `getContactById(db, userId, id)` (owned lookup), `setVerificationToken(db, userId, id, tokenHash, expiresAt, now)` (overwrites hash + expiry — resend-safe, FR-005), `findByVerificationHash(db, tokenHash)` (public lookup, no userId), and `markVerified(db, id, now)` (sets `verified_at` only if currently null — idempotent, FR-011) (depends on T003, T004)
- [ ] T008 Mount the **public** verify route in `server/src/app.ts`: create `createContactVerifyRouter(db)` and mount it at `app.use("/api/contact/verify", createContactVerifyRouter(db))` **before** the `requireAuth`-gated `/api/contact` mount (token-only authority, like the public auth callbacks); pass `APP_BASE_URL` (from `loadDeadmanConfig`/env) and the email provider into `createContactRouter` so the authed send handler can build links + notify (depends on T004)

**Checkpoint**: The contact table carries verification state, the token/email helpers exist, the repo
exposes verification functions, and the public verify router is mounted — user stories can begin.

---

## Phase 3: User Story 1 - Send a verification email and confirm a contact (Priority: P1) 🎯 MVP

**Goal**: A signed-in owner sends a verification email for their own contact; opening the emailed link
(no sign-in) flips the contact to verified.

**Independent Test**: As a signed-in owner with one contact, `POST /api/contact/{id}/verify` → assert a
verification email is dispatched through a **spy notifier** to the contact address with an
`APP_BASE_URL` token link, and a hashed token + future expiry are stored; extract the token and call
`GET /api/contact/verify?token=…` → assert `verified_at` is set and the contact serializes
`verified: true`.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [ ] T009 [P] [US1] Token-helper unit tests for `mintVerificationToken`/`hashVerificationToken` (entropy/length, deterministic SHA-256, distinct tokens → distinct hashes; raw token never equals its stored hash) in `server/tests/unit/contact-verification-token.test.ts`
- [ ] T010 [P] [US1] Repo unit tests: `setVerificationToken` stores hash + expiry (never the raw token), `findByVerificationHash` returns the matching contact, `markVerified` sets `verified_at`, and `toContact` exposes `verified`/`verifiedAt` — in `server/tests/unit/contact-repo.test.ts` (extends the existing file)
- [ ] T011 [P] [US1] Contract test for `POST /api/contact/{id}/verify` — owned contact → `200`/`201`, a verification email is sent via a **spy notifier** to the contact's address with an `APP_BASE_URL` token link, and a hashed token + future expiry are persisted; no-cookie → `401`; not-owned `id` → `404` with no email — in `server/tests/contract/contact-verify-send.test.ts`
- [ ] T012 [P] [US1] Contract test for the public `GET /api/contact/verify?token=…` — a valid fresh token → `200` `verified` and the contact's `verified_at` is set / serializes `verified: true` (the test mints a contact + token via the send flow or repo) — in `server/tests/contract/contact-verify-public.test.ts`

### Implementation for User Story 1

- [ ] T013 [US1] Add the authed `POST /:id/verify` handler to `server/src/routes/contact.ts` — load the owned contact (`getContactById`; `404` if absent), `mintVerificationToken()`, `setVerificationToken(hash, now + CONTACT_VERIFICATION_TTL_SECONDS)`, build the email via `buildVerificationEmail(appBaseUrl, token, contact.value)`, send it through the injected generic `notify()` dispatcher (email channel — never a provider directly), and respond; on a send failure return a clear error and leave the contact unverified (FR-016) (depends on T005, T006, T007)
- [ ] T014 [US1] Implement `createContactVerifyRouter(db)` `GET /verify` in `server/src/routes/contact-verify.ts` — parse the `token` query (invalid/missing → invalid result), `hashVerificationToken`, `findByVerificationHash`; if found and `now < verification_expires_at`, `markVerified(now)` and return `{ status: "verified" }`; else return the generic invalid-or-expired result (fail-closed, no disclosure) (depends on T007)
- [ ] T015 [P] [US1] Add `verifyContact(id)` (POST send) and `confirmVerification(token)` (public GET) to `client/src/api/contactClient.ts` using `apiFetch`, surfacing the server `message` on non-OK and throwing `ApiError`
- [ ] T016 [US1] Wire the contact router + public router with `APP_BASE_URL` + the email provider in `server/src/app.ts` (pass deps into `createContactRouter`; mount `createContactVerifyRouter` before `requireAuth`) so the send + verify endpoints are live end-to-end (depends on T008, T013, T014)

**Checkpoint**: An owner can send a verification email and the recipient can confirm via the link —
US1 independently testable; this is the prerequisite feature 010 (release) builds on.

---

## Phase 4: User Story 2 - See verification state and (re)send verification (Priority: P1)

**Goal**: The contact list shows a per-contact verified/unverified badge and a "Send
verification"/"Resend" action with accessible status messaging; a public result page renders the
outcome.

**Independent Test**: Render `ContactList` with mixed verified/unverified contacts → assert a distinct
text-labelled badge per state; click "Send verification" on an unverified contact → assert the send call
fires and a polite "Verification email sent." status is announced; render `ContactVerifiedPage` with a
success/failure result and assert the announced outcome.

### Tests for User Story 2 ⚠️ (write first, ensure they FAIL)

- [ ] T017 [P] [US2] Client component test: `ContactList` renders a text-labelled verified vs unverified badge per contact (not colour-only), shows "Send verification" for unverified / "Resend" for verified, and announces a polite `role="status"` confirmation on send (and `role="alert"` on failure) — in `client/tests/components/ContactList.verify.test.tsx`
- [ ] T018 [P] [US2] Client page test: `ContactVerifiedPage` reads `?token`, calls the confirm client, and renders the success ("address confirmed") vs invalid/expired/used outcome with semantic, keyboard-accessible markup — in `client/tests/pages/ContactVerifiedPage.test.tsx`

### Implementation for User Story 2

- [ ] T019 [US2] Add the verified/unverified **badge** + the "Send verification"/"Resend" **action** (per-contact `<button>` with an `aria-label` naming the contact) to `client/src/components/ContactList.tsx`, calling `verifyContact(id)`, with polite `role="status"` success and assertive `role="alert"` error messaging (mirroring the existing add/remove status pattern) (depends on T015)
- [ ] T020 [US2] Create `client/src/pages/ContactVerifiedPage.tsx` (public): read the `token` query param, call `confirmVerification(token)` on mount, and render the success / invalid-expired-used result with a semantic heading + `role="status"`/`role="alert"`; register a **public** route `/contact-verified` in `client/src/App.tsx` **outside** `ProtectedRoute` (depends on T015, T018)
- [ ] T021 [P] [US2] Add the verified/unverified badge CSS classes (WCAG AA contrast, text-labelled, not colour-only, focus states) to `client/src/styles.css`

**Checkpoint**: Owners can see verification state and (re)send from the UI; recipients see a clear
result page — US1 + US2 both work independently.

---

## Phase 5: User Story 3 - Token lifecycle: expired, used, and invalid links (Priority: P1)

**Goal**: The public verify endpoint is short-lived, single-use, and fail-closed: expired, already-used,
and invalid/unknown tokens never verify a contact and disclose nothing.

**Independent Test**: Mint a token; (a) advance past `verification_expires_at` and open → failure,
contact unverified; (b) open a valid link twice → first verifies, second returns invalid/used without
re-setting `verified_at`; (c) open with a random token → generic failure with no contact/owner
disclosure.

### Tests for User Story 3 ⚠️ (write first, ensure they FAIL)

- [ ] T022 [P] [US3] Contract tests for the public `GET /api/contact/verify` failure paths — expired token (`verification_expires_at` in the past) → `invalid_or_expired`, contact stays unverified; replay (open a valid token twice) → second call `invalid_or_expired`, `verified_at` unchanged; missing/malformed token and an unknown random token → generic `invalid_or_expired` revealing no contact/owner existence — appended to `server/tests/contract/contact-verify-public.test.ts`
- [ ] T023 [P] [US3] Repo unit test: after `markVerified` (or a resend via `setVerificationToken`) the prior `verification_token_hash` no longer matches, so `findByVerificationHash` for the old hash returns null (single-use / resend-supersede) — appended to `server/tests/unit/contact-repo.test.ts`

### Implementation for User Story 3

- [ ] T024 [US3] Harden `GET /verify` in `server/src/routes/contact-verify.ts`: enforce the inclusive expiry boundary (`now >= verification_expires_at` → fail), consume the token on success (so a replay finds no match), and return a single generic `invalid_or_expired` result for expired/used/unknown/malformed (no branching that leaks contact existence) (depends on T014)
- [ ] T025 [US3] Ensure `markVerified` clears or supersedes `verification_token_hash` on success (so the link is single-use) and `setVerificationToken` overwrites the prior hash on resend, in `server/src/db/contact-repo.ts` (depends on T007)

**Checkpoint**: Expired/used/invalid links never verify and never disclose — the security core is
provable. US1–US3 independently functional.

---

## Phase 6: User Story 4 - Idempotent re-verification & unverified-by-default (Priority: P2)

**Goal**: Re-confirming an already-verified contact is non-destructive, and pre-existing contacts are
unverified by default.

**Independent Test**: A pre-existing contact (null `verified_at`) serializes `verified: false`. Verify
once, then open a fresh valid link again → success ("already verified") with `verified_at` unchanged.
Resend to a verified contact → accepted, new token stored, `verified_at` unchanged.

### Tests for User Story 4 ⚠️ (write first, ensure they FAIL)

- [ ] T026 [P] [US4] Repo/contract test: a contact row with null verification columns serializes `verified: false`/`verifiedAt: null`; `markVerified` is idempotent (a second call leaves the original `verified_at`); resend to a verified contact stores a new hash but leaves `verified_at` unchanged — in `server/tests/unit/contact-repo.test.ts` and `server/tests/contract/contact-verify-public.test.ts` (extends T010/T012)
- [ ] T027 [P] [US4] Contract test: `POST /api/contact/{id}/verify` for an already-verified contact is accepted (resend), and a subsequent valid-link open returns `already_verified` with `verified_at` unchanged — appended to `server/tests/contract/contact-verify-send.test.ts`

### Implementation for User Story 4

- [ ] T028 [US4] Confirm `markVerified` only sets `verified_at` when currently null and otherwise returns the existing timestamp (returning a `verified` vs `already_verified` status), and that `GET /verify` maps the already-verified case to `{ status: "already_verified" }`, in `server/src/db/contact-repo.ts` + `server/src/routes/contact-verify.ts` (depends on T007, T024)
- [ ] T029 [US4] Confirm `toContact` derives `verified`/`verifiedAt` purely from `verified_at` so every pre-existing (null) row is unverified by default, with a unit assertion over a hand-inserted legacy row in `server/src/db/contact-repo.ts` / `server/tests/unit/contact-repo.test.ts` (depends on T007)

**Checkpoint**: Re-verification is idempotent and old contacts are unverified by default. US1–US4
independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Cross-cutting isolation, end-to-end coverage, no-token-leak assertions, docs, and quality
gates.

- [ ] T030 [P] Cross-cutting assertion: grep/inspect that the raw verification token never appears in any log line, event detail, or serialized contact across the suite (only its SHA-256 hash is stored) — assert within `server/tests/contract/contact-verify-send.test.ts` / `contact-verify-public.test.ts` (FR-012, SC-006)
- [ ] T031 Create `e2e/contact-verification.spec.ts` (Playwright): `loginAs` → add a contact → "Send verification" → read the verification link from the captured stub email → open `/contact-verified?token=…` → confirm the success result → reload the contact list and assert the verified badge — using `loginAs`/`resetContacts`
- [ ] T032 Update `README.md`: **Architecture** (the contact verification columns, the authed `POST /api/contact/{id}/verify` + public `GET /api/contact/verify` round-trip via `notify()` with an `APP_BASE_URL` link, verified-as-release-prerequisite) and **Tests** (the new verification test files) — in the same commits as the code slices; **Run** and **Manual setup** unchanged (`APP_BASE_URL` already documented by feature 008) (per CLAUDE.md README policy)
- [ ] T033 [P] Run the full gates and quickstart validation: `npm run typecheck`, `npm test`, `npm run test:e2e`, and the manual steps in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 [P] is independent; T002 → T003 (gen:api needs the updated contract).
- **Foundational (Phase 2)**: Depends on Setup (generated types + TTL). BLOCKS all stories. T004 (columns)
  precedes the repo work; T005/T006 are [P] (different files); T007 waits on T003+T004; T008 waits on T004.
- **User Stories (Phase 3–6)**: All depend on Foundational. Implemented in priority order
  (US1 → US2 → US3 → US4). They grow the same shared files (`contact-repo.ts`, `routes/contact.ts`,
  `routes/contact-verify.ts`, `contactClient.ts`, `ContactList.tsx`), so cross-story edits to those files
  are **sequential by design**, not parallel.
- **Polish (Phase 7)**: T030 after the send/verify endpoints; T031 after the UI + endpoints; T032/T033 last.

### Within Each User Story

- Tests (the `### Tests` block) are written first and must FAIL before implementation.
- Token/email helpers before the repo functions that use them; repo functions before the route handlers;
  route before the client API; client API before the UI increment.
- US1 must precede US2/US3/US4 only because they extend the same shared files; each story remains
  independently testable at its checkpoint.

### Parallel Opportunities

- T001 runs alongside T002.
- Foundational: T005, T006 are [P] (different files); T007 waits on T004; T008 waits on T004.
- Each story's `### Tests` tasks ([P]) run together (distinct files), as can the helper/client-API
  creation tasks marked [P].
- T021, T030, and T033 are [P] relative to each other.

---

## Parallel Example: User Story 1

```bash
# Write US1 tests together first (distinct files):
Task: "Token-helper unit tests in server/tests/unit/contact-verification-token.test.ts"   # T009
Task: "Repo unit tests in server/tests/unit/contact-repo.test.ts"                          # T010
Task: "Send contract test in server/tests/contract/contact-verify-send.test.ts"            # T011
Task: "Public verify contract test in server/tests/contract/contact-verify-public.test.ts" # T012

# Then implement (helpers/client-API in parallel; routes wait on them):
Task: "Create server/src/contacts/verification-token.ts"                                   # T005 (foundational)
Task: "Create server/src/contacts/verification-email.ts"                                   # T006 (foundational)
Task: "Add verifyContact/confirmVerification to client/src/api/contactClient.ts"           # T015
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & VALIDATE**: an owner can send a
   verification email and the recipient can confirm via the link (the contact flips to verified — the
   prerequisite feature 010 needs). Deploy/demo.

### Incremental Delivery (matches plan.md PR slices)

1. Setup + Foundational + US1 → MVP (send → confirm round-trip).
2. US2 (badge + (re)send UI + public result page) → component/page tests green → demo.
3. US3 (token lifecycle: expired/used/invalid, fail-closed) → contract tests green → demo.
4. US4 (idempotent re-verify + unverified-by-default) → test → demo.
5. Polish (no-token-leak assertion, e2e, README, gates).

Each story adds value without breaking the previous; commit after each task or logical group as its own
bisectable `feat:` commit.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- Shared files (`contact-repo.ts`, `routes/contact.ts`, `routes/contact-verify.ts`, `contactClient.ts`,
  `ContactList.tsx`) are intentionally grown across stories in priority order — that's why those impl
  tasks are NOT marked [P] across phases.
- The **send** endpoint is authed + scoped by `req.user.id` (non-owned `id` → `404`); the **verify**
  endpoint is **public** (token-only authority) and **fail-closed** (expired/used/invalid → generic
  result, no disclosure).
- The verification token reuses the existing SHA-256 hashed-token pattern (`auth/tokens.ts`): shown once
  in the email link, only the hash stored; the raw token never appears in a log, event, or serialized
  contact (FR-012, SC-006).
- Emails are sent only through the generic `notify()` dispatcher (email channel); the body carries a
  single `APP_BASE_URL` link and no secret (FR-004).
- Pre-existing contacts are unverified by default (columns added nullable, no backfill; null
  `verified_at` ⇒ unverified).
- This feature adds endpoints + a verification round-trip but **no new env var or external service** (it
  reuses `APP_BASE_URL` and the existing email channel), so only the README **Architecture** and
  **Tests** sections change (T032).
- Verify each story's tests fail before implementing it.
```
