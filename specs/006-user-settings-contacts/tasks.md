---

description: "Task list for User Settings Page — Manage Contacts"
---

# Tasks: User Settings Page — Manage Contacts

**Input**: Design documents from `/specs/006-user-settings-contacts/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/contact-api.md, quickstart.md

**Tests**: MANDATORY (Constitution Principle I — TDD, NON-NEGOTIABLE). Each story's tests are written
before/alongside its implementation and must pass in CI before merge.

**Organization**: Tasks are grouped by user story. The shared backbone (contract, types, table,
router mount, test-reset) lives in Setup/Foundational; each story then adds its repo function(s),
endpoint handler, client API call, and UI increment — all independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (view), US2 (add), US3 (remove)
- Exact file paths are included in every task

## Path Conventions

Web-app npm workspaces: `server/src`, `server/tests`, `client/src`, `client/tests`, `shared/src`,
`contracts/`, `e2e/` — per plan.md Structure Decision.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Contract and shared types in place before any code consumes them.

- [x] T001 [P] Add `CONTACT_MAX_LENGTH = 320` and `CONTACT_LIMIT = 50` to `shared/src/constants.ts` and re-export both from `shared/src/index.ts`
- [x] T002 Add the `/contact` and `/contact/{id}` paths and the `Contact`, `ContactInput`, and `ContactListResponse` schemas to `contracts/openapi.yaml`, mirroring the Note style (per `contracts/contact-api.md`)
- [x] T003 Run `npm run gen:api` to regenerate `shared/src/api.ts` from the updated `contracts/openapi.yaml` (depends on T002)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Server table, router wiring, and test seams that ALL stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Add the `contact` table DDL (`id` PK, `user_id` FK, `type`, `value`, `value_norm`, `created_at`, `UNIQUE(user_id, type, value_norm)`) and `idx_contact_user_id` index to `openDb()` in `server/src/db/index.ts` (per data-model.md)
- [x] T005 [P] Create `server/src/db/contact-repo.ts` with the `Contact` type import (from `@ensure/shared/api`), a row→`Contact` mapper (omitting `value_norm`), and `clearContacts(db)`; story functions are added in later phases
- [x] T006 Create an empty `createContactRouter(db)` in `server/src/routes/contact.ts`, mount it via `app.use("/api/contact", requireAuth, createContactRouter(db))` in `server/src/app.ts`, and extend the `POST /api/test/reset` handler there to also call `clearContacts(db)` (depends on T005)
- [x] T007 [P] Add a `resetContacts(page)` helper (calling `POST /api/test/reset`) to `e2e/support/auth.ts` for use by the contacts e2e spec

**Checkpoint**: Backbone ready — the `/api/contact` router is mounted and auth-gated; user stories can begin.

---

## Phase 3: User Story 1 - View my contacts in settings (Priority: P1) 🎯 MVP

**Goal**: A signed-in user opens `/settings` and sees their contact list (or an empty state); only their own contacts are shown.

**Independent Test**: Sign in (test-login) as users with zero, one, and several contacts; open `/settings` and confirm the empty state vs. populated list renders correctly and shows only that user's contacts.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [x] T008 [P] [US1] Contract test for `GET /api/contact` (empty → `200 {contacts: []}`; populated → `Contact[]` with exactly `[id, type, value, createdAt]` keys; no-cookie → `401`) in `server/tests/contract/contact-list.test.ts`
- [x] T009 [P] [US1] Repo unit test for `listContacts` (returns only the given user's rows, ordered by `created_at`) in `server/tests/unit/contact-repo.test.ts`
- [x] T010 [P] [US1] Client component test: `ContactList` renders the empty state with no contacts and renders a `<li>` per contact when populated, in `client/tests/components/ContactList.view.test.tsx`

### Implementation for User Story 1

- [x] T011 [US1] Add `listContacts(db, userId): Contact[]` to `server/src/db/contact-repo.ts`
- [x] T012 [US1] Add the `GET /` handler (returns `200 { contacts: listContacts(db, req.user.id) }`) to `server/src/routes/contact.ts` (depends on T011)
- [x] T013 [P] [US1] Add `getContacts(): Promise<Contact[]>` (using `apiFetch`, throwing `ApiError`) to `client/src/api/contactClient.ts`
- [x] T014 [US1] Create `client/src/components/ContactList.tsx` — load via `getContacts` on mount, a `loading | idle | error` status union, an accessible empty state, and a semantic `<ul>/<li>` list of contact values (ARIA `role="status"`/`role="alert"`) (depends on T013)
- [x] T015 [US1] Create `client/src/pages/SettingsPage.tsx` (header with user email + sign-out, rendering `<ContactList/>`) and register a protected `/settings` route plus a "Settings" nav link (and a back link) in `client/src/App.tsx` (depends on T014)

**Checkpoint**: `/settings` displays the signed-in user's contacts and empty state — US1 independently testable.

---

## Phase 4: User Story 2 - Add an email contact (Priority: P1)

**Goal**: A signed-in user adds a valid email from `/settings` and sees it appear; invalid, duplicate, and over-limit attempts are rejected with clear messages.

**Independent Test**: From `/settings`, add a valid email → it appears and persists across reload; submit an invalid email, a case-variant duplicate, and (with 50 present) a 51st → each is rejected with the right message and nothing is stored.

### Tests for User Story 2 ⚠️ (write first, ensure they FAIL)

- [x] T016 [P] [US2] Validation unit tests for `parseContactInput` (accepts a valid email; rejects empty, malformed email, non-`email` type, and `value` > 320 chars) in `server/tests/unit/contact-validation.test.ts`
- [x] T017 [P] [US2] Repo unit tests appended to `server/tests/unit/contact-repo.test.ts`: `addContact` preserves original case in `value`; `findByNormalized` matches case-insensitively/trimmed; `countContacts` returns the per-user count
- [x] T018 [P] [US2] Contract test for `POST /api/contact` (valid → `201 Contact` echoing original case; non-`email` type & malformed & >320 → `400 VALIDATION_ERROR`; case-variant duplicate → `409 DUPLICATE_CONTACT`; 51st → `409 CONTACT_LIMIT_REACHED`; no-cookie → `401`) in `server/tests/contract/contact-add.test.ts`
- [x] T019 [P] [US2] Client component test: `ContactList` add flow (success appends row; validation/duplicate errors shown; add control disabled at `CONTACT_LIMIT`) in `client/tests/components/ContactList.add.test.tsx`

### Implementation for User Story 2

- [x] T020 [P] [US2] Create `server/src/validation/contact.ts` — Zod schema (`type` is `"email"`, `value` trimmed/`.email()`/`max(CONTACT_MAX_LENGTH)`) returning the `ParseResult` discriminated union (mirroring `validation/note.ts`)
- [x] T021 [US2] Add `addContact(db, userId, type, value, now?)`, `countContacts(db, userId)`, and `findByNormalized(db, userId, type, valueNorm)` to `server/src/db/contact-repo.ts` (derive `value_norm`, assign `randomUUID()` id)
- [x] T022 [US2] Add the `POST /` handler to `server/src/routes/contact.ts`: validate (`400`), reject duplicate via `findByNormalized` (`409 DUPLICATE_CONTACT`), reject when `countContacts` ≥ `CONTACT_LIMIT` (`409 CONTACT_LIMIT_REACHED`), else insert and return `201 Contact` (depends on T020, T021)
- [x] T023 [P] [US2] Add `addContact(value: string): Promise<Contact>` (POST `{ type: "email", value }`, surfacing server `message` on non-OK) to `client/src/api/contactClient.ts`
- [x] T024 [US2] Add the add-contact form to `client/src/components/ContactList.tsx` — a `<label>`-bound `<input type="email" maxLength={CONTACT_MAX_LENGTH}>` + submit button, `adding`/`error` states with ARIA live messaging, optimistic refresh on success, and the add control disabled at `CONTACT_LIMIT` (depends on T023)

**Checkpoint**: Users can add email contacts with full validation — US1 + US2 both work independently.

---

## Phase 5: User Story 3 - Remove a contact (Priority: P2)

**Goal**: A signed-in user removes a contact from `/settings` and sees it disappear; removal is idempotent and scoped to the owner.

**Independent Test**: With ≥1 contact, remove it → it disappears and stays gone after reload; removing an already-deleted contact reports no error.

### Tests for User Story 3 ⚠️ (write first, ensure they FAIL)

- [x] T025 [P] [US3] Repo unit test appended to `server/tests/unit/contact-repo.test.ts`: `removeContact` deletes only the owner's matching row and returns `false` (no-op) for a missing/other-user id
- [x] T026 [P] [US3] Contract test for `DELETE /api/contact/:id` (existing → `204` then gone from `GET`; repeat → `204` idempotent; another user's id → `204` no-op and the owner still has it; no-cookie → `401`) in `server/tests/contract/contact-remove.test.ts`
- [x] T027 [P] [US3] Client component test: `ContactList` remove flow (clicking Remove deletes the row; error surfaced on failure) in `client/tests/components/ContactList.remove.test.tsx`

### Implementation for User Story 3

- [x] T028 [US3] Add `removeContact(db, userId, id): boolean` (scoped `DELETE ... WHERE id = ? AND user_id = ?`) to `server/src/db/contact-repo.ts`
- [x] T029 [US3] Add the `DELETE /:id` handler (always `204`, idempotent, scoped to `req.user.id`) to `server/src/routes/contact.ts` (depends on T028)
- [x] T030 [P] [US3] Add `removeContact(id: string): Promise<void>` to `client/src/api/contactClient.ts`
- [x] T031 [US3] Add an accessibly-named per-row "Remove" button + handler (with `removing` state) to `client/src/components/ContactList.tsx` (depends on T030)

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cross-story verification, end-to-end coverage, docs, and quality gates.

- [x] T032 [P] Cross-cutting contract test: two test-login users (distinct `sub`) — user B's `GET` never shows A's contacts, and B `DELETE`-ing A's id is a no-op leaving A's contact intact (FR-003) — in `server/tests/contract/contact-isolation.test.ts`
- [x] T033 Create `e2e/settings-contacts.spec.ts` (Playwright): add a contact and confirm it persists after reload; remove it and confirm it stays gone; a second user sees only their own contacts — using `loginAs`/`resetContacts`
- [x] T034 Update the **Architecture** section of `README.md` to record the new settings/contacts component, the `/api/contact` endpoints, and the `contact` table (same commit as the server/client slices; per CLAUDE.md README policy)
- [x] T035 [P] Run the full gates and quickstart validation: `npm run typecheck`, `npm test`, `npm run test:e2e`, and the manual steps in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 [P] is independent; T002 → T003 (gen:api needs the updated contract).
- **Foundational (Phase 2)**: Depends on Setup (needs generated types + constants). BLOCKS all stories.
- **User Stories (Phase 3–5)**: All depend on Foundational. Implemented in priority order (US1 → US2 → US3); they share `contact-repo.ts`, `routes/contact.ts`, `contactClient.ts`, and `ContactList.tsx`, so cross-story edits to those files are sequential by design (incremental delivery), not parallel.
- **Polish (Phase 6)**: Depends on the stories it exercises (T032 after US1–US3 endpoints; T033 after the full UI; T034/T035 last).

### Within Each User Story

- Tests (the `### Tests` block) are written first and must FAIL before implementation.
- Repo function → endpoint handler → client API call → UI increment.
- US1 must precede US2/US3 only because they extend the same shared files; behavior of each story remains independently testable at its checkpoint.

### Parallel Opportunities

- T001 runs alongside T002.
- Foundational: T005 and T007 are [P] (different files); T006 waits on T005.
- Each story's `### Tests` tasks ([P]) run together (distinct files), as can the client-API task ([P]).
- T032 and T035 are [P] relative to each other.

---

## Parallel Example: User Story 1

```bash
# Write US1 tests together first (distinct files):
Task: "Contract test GET /api/contact in server/tests/contract/contact-list.test.ts"   # T008
Task: "Repo unit test listContacts in server/tests/unit/contact-repo.test.ts"          # T009
Task: "Component test ContactList view in client/tests/components/ContactList.view.test.tsx"  # T010

# Then implement (T013 client API in parallel with server T011/T012):
Task: "Add getContacts() in client/src/api/contactClient.ts"                            # T013
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & VALIDATE**: `/settings` lists the user's contacts. Deploy/demo.

### Incremental Delivery (matches plan.md PR slices)

1. Setup + Foundational + US1 → MVP (view) — PR slice 1 server backbone is exercised here.
2. US2 (add) → test → demo.
3. US3 (remove) → test → demo.
4. Polish (isolation test, e2e, README, gates).

Each story adds value without breaking the previous; commit after each task or logical group.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- Shared files (`contact-repo.ts`, `routes/contact.ts`, `contactClient.ts`, `ContactList.tsx`) are intentionally grown across stories in priority order — that's why those impl tasks are NOT marked [P] across phases.
- Verify each story's tests fail before implementing it.
- No new env var or external service is introduced; only the README **Architecture** section changes (T034).
- Contacts are stored as plaintext (research.md D7) — no encryption tasks by design.
