---
description: "Task list for Per-User Note Ownership & Encryption at Rest"
---

# Tasks: Per-User Note Ownership & Encryption at Rest

**Input**: Design documents from `/specs/004-note-ownership-encryption/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅ (note-api.md, reencrypt-cli.md), quickstart.md ✅

**Tests**: Per Constitution Principle I (Test-Driven Development, NON-NEGOTIABLE), test tasks are MANDATORY and MUST be written before / alongside the implementation they cover. Every story below leads with its tests.

**Organization**: Tasks are grouped by user story (US1 → US2 → US3, priority order from spec.md) so each story is an independently testable increment.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependency on another incomplete task)
- **[Story]**: `US1`/`US2`/`US3` for user-story tasks; Setup/Foundational/Polish carry no story label
- Exact file paths are included in every task

## Path Conventions

Existing web-app layout (npm workspaces): server code in `server/src/`, server tests in `server/tests/`, e2e in `e2e/`, the API contract in `contracts/openapi.yaml` (repo root). Encryption lives in the new `server/src/crypto/` module; the operator command in `server/src/cli/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Wiring and environment the rest of the feature builds on. No production data exists (research D7), so the schema is recreated fresh rather than migrated.

- [x] T001 [P] Add a `reencrypt` script to `server/package.json` (`"reencrypt": "tsx src/cli/reencrypt-notes.ts"`) so the operator bulk re-encryption runs via `npm run reencrypt --workspace server` (reencrypt-cli.md).
- [x] T002 [P] Configure the encryption keyring env for local dev and e2e: add `NOTE_ENC_KEYS` (`version:base64-32B` entries) and `NOTE_ENC_ACTIVE_VERSION` to `server/.env` (local) and to the e2e server environment in `e2e/global-setup.ts` (a deterministic test key), following quickstart.md §1–2. Never commit real secret values.
- [x] T003 [P] Reset disposable SQLite files so the reworked per-user `note` table is created fresh (the old `CHECK (id = 1)` table is not altered by `CREATE TABLE IF NOT EXISTS`): delete the configured dev DB and any e2e DB plus their `-wal`/`-shm` siblings (e.g. `./data/note.db*`, `e2e.db*`) per quickstart.md §3.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The crypto module (keyring + cipher), the env validation that fails closed at boot, the reworked `note` schema, and a shared test keyring fixture. **Every user story depends on these.**

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

### Tests (write first — must fail before implementation)

- [x] T004 [P] Unit tests for the cipher in `server/tests/unit/note-cipher.test.ts`: `seal`→`open` round-trips arbitrary text losslessly (FR-009); a flipped byte in the BLOB (ciphertext or tag) makes `open` throw — GCM tamper rejection (D1, FR-015); decrypting with the wrong key throws; two `seal` calls on identical plaintext produce different BLOBs (fresh 12-byte nonce per call).
- [x] T005 [P] Unit tests for the keyring in `server/tests/unit/keyring.test.ts`: parses `NOTE_ENC_KEYS` into versions; rejects keys that do not base64-decode to exactly 32 bytes; rejects duplicate or non-positive versions; rejects an active version absent from the keyring; `getActiveVersion`/`getKey`/`listVersions`/`hasVersion` behave per data-model.md (`getKey` of an unknown version throws). Fail-closed on any violation (FR-015).
- [x] T006 [P] Extend `server/tests/unit/env.test.ts`: `loadEnv` throws (process refuses to boot) when `NOTE_ENC_KEYS` is missing/malformed or `NOTE_ENC_ACTIVE_VERSION` is missing/not present in the keyring; succeeds and exposes a built `Keyring` when valid (D6, FR-015, FR-016 — secrets never echoed in the error text).

### Implementation

- [x] T007 [P] Implement AES-256-GCM `seal(key, plaintext)` / `open(key, blob)` over a `nonce(12) ‖ ciphertext ‖ authTag(16)` Buffer using `node:crypto` (no new dependency) in `server/src/crypto/note-cipher.ts` (research D1).
- [x] T008 Implement the `Keyring` (parse/validate `NOTE_ENC_KEYS` + `NOTE_ENC_ACTIVE_VERSION`; `getActiveVersion`/`getKey`/`listVersions`/`hasVersion`) in `server/src/crypto/keyring.ts` (data-model.md "Encryption Keyring"; FR-010, FR-011). (Depends on nothing in this repo; pairs with T005.)
- [x] T009 Extend the Zod schema and `loadEnv` to read `NOTE_ENC_KEYS` + `NOTE_ENC_ACTIVE_VERSION`, build the `Keyring`, and expose it on the returned config (throw → fail-closed boot, secrets never logged) in `server/src/config/env.ts` (D2, D6, FR-015, FR-016). Depends on T008.
- [x] T010 Rework the `note` table in `server/src/db/index.ts`: replace the singleton `note (id …CHECK(id=1), text, …)` with `note (user_id TEXT PRIMARY KEY REFERENCES user(id), ciphertext BLOB NOT NULL, key_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)` plus `CREATE INDEX idx_note_key_version ON note(key_version)` (data-model.md, research D4; FR-001, FR-008, FR-010, FR-018).
- [x] T011 Add a deterministic test keyring fixture (e.g. `TEST_ENCRYPTION_KEYRING`) and export it from `server/tests/helpers/auth.ts` so story tests can construct an app/repo with a real keyring. Depends on T008.

**Checkpoint**: Crypto, env validation, schema, and test fixtures are in place — user stories can begin.

---

## Phase 3: User Story 1 - My note is private to me (Priority: P1) 🎯 MVP

**Goal**: Each note belongs to the authenticated person; reads/writes are scoped to `req.user.id` so addressing another user's note is structurally impossible. A user with no note sees an empty state; unauthenticated requests are refused.

**Independent Test**: Sign in as A, save a note, sign out; sign in as B → B sees an empty note (not A's), save B's note; sign back in as A → A still sees A's note. No endpoint accepts a target user id, so A can never address B's note (research D5; FR-002…FR-007).

### Tests for User Story 1 (write first — must fail before implementation) ⚠️

- [x] T012 [P] [US1] Integration test in `server/tests/integration/note-isolation.test.ts`: two test-login users with distinct `sub` — A saves "alpha", B saves "beta"; A's GET returns "alpha", B's GET returns "beta"; neither response ever contains the other's text (FR-003, FR-005). Use `loginTestUser(app, { sub })` for distinct identities.
- [x] T013 [P] [US1] Integration test in `server/tests/integration/note-protected.test.ts` (extend/confirm): unauthenticated GET and PUT `/api/note` → `401 { error: "UNAUTHORIZED" }` (FR-007).
- [x] T014 [P] [US1] Contract test in `server/tests/contract/note-isolation.test.ts`: GET with no note → `200 { note: null }` for a fresh user (FR-006); two distinct-`sub` users round-trip their own text and never observe each other's (note-api.md "Contract tests"; FR-003, FR-005).
- [x] T015 [P] [US1] E2e in `e2e/note-isolation.spec.ts`: two test-login users (distinct `sub`) each see only their own note in the browser (quickstart.md §4; spec Independent Test).

### Implementation for User Story 1

- [x] T016 [US1] Rework `server/src/db/note-repo.ts` to be per-user and encrypted: `getNote(db, userId, keyring)` reads the caller's row and decrypts (returns `null` when absent); `upsertNote(db, userId, text, keyring, now?)` seals `text` with the **active** version and inserts/replaces the caller's row (preserving `created_at`, advancing `updated_at`); `clearNote(db)` deletes all rows. Returned `Note` keeps `{ text, createdAt, updatedAt }` so `shared/src/api.ts` is unchanged (data-model.md "Repository surface"; FR-001, FR-009, FR-012, FR-012a, FR-018, FR-019). Depends on T007, T010.
- [x] T017 [US1] Scope the routes to the authenticated owner in `server/src/routes/note.ts`: `createNoteRouter(db, keyring)`; GET/PUT derive the owner from `req.user.id` and call the per-user repo; PUT still validates via `parseNoteInput` (length ≤10,000 before encryption — FR-017). No endpoint accepts a target user id (research D5; FR-002, FR-003, FR-004). Depends on T016.
- [x] T018 [US1] Thread the keyring through app construction: add `encryption: Keyring` to `AppOptions` and pass it into `createNoteRouter` in `server/src/app.ts`; pass the loaded keyring from `server/src/server.ts`; supply `TEST_ENCRYPTION_KEYRING` in `makeTestApp` in `server/tests/helpers/auth.ts` (plan "Project Structure" app.ts/server.ts). Depends on T009, T011, T017.
- [x] T019 [US1] Update existing note tests that assumed the shared singleton note to per-user semantics (same-user save→read still round-trips) in `server/tests/contract/get-note.test.ts`, `server/tests/contract/put-note.test.ts`, `server/tests/integration/get-note.test.ts`, `server/tests/integration/put-note.test.ts`. Depends on T018.

**Checkpoint**: US1 fully functional — per-user ownership and isolation hold; this is the MVP.

---

## Phase 4: User Story 2 - My note is unreadable in the database (Priority: P2)

**Goal**: Stored note content is ciphertext only (no plaintext column), round-trips losslessly for the owner, and **fails closed** when the required key is unavailable or the auth tag fails — never serving plaintext.

**Independent Test**: Save a note, inspect the stored row directly → no plaintext appears, only `ciphertext`/`key_version`; reload as owner → exact original text. Point a row at a key version absent from the keyring → read is refused with a clear error, never plaintext (spec US2 Independent Test; FR-008, FR-009, FR-015).

### Tests for User Story 2 (write first — must fail before implementation) ⚠️

- [x] T020 [P] [US2] Integration test in `server/tests/integration/note-encryption.test.ts`: after PUT, the stored `ciphertext` BLOB does **not** contain the plaintext bytes (FR-008, SC-003); PUT→GET returns the exact text, including unicode/edge content (lossless round-trip, FR-009, SC-004).
- [x] T021 [P] [US2] Integration test in `server/tests/integration/note-fail-closed.test.ts`: a stored row whose `key_version` is not in the keyring (or whose ciphertext is tampered) → GET `/api/note` returns `500 { error: "NOTE_DECRYPT_FAILED" }` and the body contains **no** note text (FR-015, SC-007).
- [x] T022 [P] [US2] Contract test in `server/tests/contract/note-fail-closed.test.ts`: the fail-closed read matches the established error envelope `{ error: "NOTE_DECRYPT_FAILED", message }` with no note content (note-api.md GET table, row 4).

### Implementation for User Story 2

- [x] T023 [US2] Make `getNote` fail closed in `server/src/db/note-repo.ts`: when `row.key_version` is absent from the keyring (`!keyring.hasVersion`) or `open` throws (auth-tag failure), throw a typed decrypt error — never return plaintext or a partial result; do not log secrets or plaintext (research D6; FR-015, FR-016). Depends on T016.
- [x] T024 [US2] Map the decrypt failure to `500 { error: "NOTE_DECRYPT_FAILED", message: <generic> }` in the GET handler in `server/src/routes/note.ts`, keeping the existing error envelope and logging no secrets/plaintext (note-api.md; FR-015). Depends on T017, T023.

**Checkpoint**: US1 + US2 both hold — notes are owner-scoped, encrypted at rest, lossless, and fail closed.

---

## Phase 5: User Story 3 - The encryption secret can be rotated safely (Priority: P3)

**Goal**: Introduce a new key version while old notes stay readable; new/updated notes use the active version (lazy migration); an operator bulk re-encryption forces completion; an old version can be retired only once no note depends on it.

**Independent Test**: With notes under v1, add v2 as active → old notes still read, new saves use v2; run the re-encryption → every note is on v2; `notesUsingVersion(1) = 0`; retire v1 → all notes still read (spec US3 Independent Test; FR-011…FR-014, SC-005, SC-006).

### Tests for User Story 3 (write first — must fail before implementation) ⚠️

- [x] T025 [P] [US3] Unit/repo test in `server/tests/unit/note-repo-reencrypt.test.ts`: seed rows under v1 with active=v2, run `reencryptAll` → every row has `key_version = 2` and still decrypts to its original plaintext (no data loss, SC-005/SC-006); `notesUsingVersion(1) = 0` and `notesUsingVersion(2)` equals the note count; `created_at`/`updated_at` are unchanged by the re-seal (reencrypt-cli.md Tests); a row whose `key_version` is absent from the keyring makes the pass fail loudly (no silent skip, FR-015).
- [x] T026 [P] [US3] Integration test in `server/tests/integration/note-lazy-rotation.test.ts`: a note saved under v1, then updated by its owner while active=v2 → its `key_version` becomes 2 (lazy migration, FR-012a); a v1 note read while v1 is still in the keyring returns correct plaintext (FR-011, mixed-version read FR-010).
- [x] T027 [P] [US3] CLI test in `server/tests/unit/reencrypt-cli.test.ts`: invoking the bulk re-encryption migrates non-active rows and prints `migrated=<n> remaining_by_version={…}`; exits non-zero when the keyring is invalid or a row cannot be decrypted (reencrypt-cli.md Output/Tests; FR-013, FR-014).

### Implementation for User Story 3

- [x] T028 [US3] Add `reencryptAll(db, keyring) → { migrated, perVersion }` (decrypt rows where `key_version ≠ active`, re-seal with active, set `key_version = active`, leave timestamps untouched) and `notesUsingVersion(db, version) → number` to `server/src/db/note-repo.ts` (data-model.md "Repository surface"; FR-013, FR-014). Depends on T016.
- [x] T029 [US3] Implement the operator bulk re-encryption CLI in `server/src/cli/reencrypt-notes.ts`: load env + keyring (same fail-closed validation as startup), call `reencryptAll`, print `migrated=… remaining_by_version=…`, exit `0` on success and non-zero if the keyring is invalid or a row can't be decrypted (loud, never silent) — the retirement guard the runbook gates on (reencrypt-cli.md; FR-013, FR-014, FR-015). Depends on T028, T009.

**Checkpoint**: All three stories independently functional — ownership, encryption-at-rest, and safe rotation.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation truth and end-to-end validation. (No client UI changes — the note editor already calls GET/PUT `/api/note`.)

- [x] T030 [P] Update the note path descriptions in `contracts/openapi.yaml` to say the note is **per-user** and document the new `NOTE_DECRYPT_FAILED` 500 condition — request/response **shapes stay unchanged**, so `shared/src/api.ts` is not regenerated (research D8; note-api.md).
- [x] T031 [P] Update `README.md` per its maintenance rules: **Architecture** (note is now per-user and encrypted at rest via the `server/src/crypto/` keyring; fail-closed reads) and **Manual setup** (`NOTE_ENC_KEYS`, `NOTE_ENC_ACTIVE_VERSION` — name, purpose, how to generate, that the server refuses to boot without a valid active key). Touch **Run/Tests** only if their commands changed; otherwise leave them.
- [x] T032 Run the quickstart.md validation and rotation runbook end-to-end: `npm test`, `npm run test:e2e`, `npm run typecheck` all green, then exercise the rotation runbook (add v2, `npm run reencrypt --workspace server`, confirm `0` v1 rows, retire v1, notes still read) — the merge quality gates (tests + `tsc`) must pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**.
- **User Stories (Phase 3–5)**: All depend on Foundational. Recommended in priority order P1 → P2 → P3; US2 and US3 build on US1's per-user repo/routes (same files), so they are not fully parallel with US1 here.
- **Polish (Phase 6)**: Depends on the stories it documents being complete.

### Story-level dependencies (driven by shared files)

- **US1 (P1)**: Starts after Foundational. No dependency on other stories. **MVP.**
- **US2 (P2)**: Extends `note-repo.ts` (T023) and `routes/note.ts` (T024) created in US1 → depends on T016/T017.
- **US3 (P3)**: Extends `note-repo.ts` (T028) created in US1 → depends on T016; the CLI (T029) also depends on env/keyring (T009).

### Within each story

- Tests are written first and must FAIL before implementation (Constitution Principle I).
- Cipher/keyring/schema (Foundational) → repo → routes → app wiring.
- `server/src/db/note-repo.ts` is edited in T016 (US1), T023 (US2), T028 (US3) — **same file, sequential, not [P] across stories**.
- `server/src/routes/note.ts` is edited in T017 (US1) and T024 (US2) — sequential.

### Parallel Opportunities

- Setup: T001, T002, T003 all [P].
- Foundational tests T004, T005, T006 all [P]; implementations T007 (cipher) is [P] with the test-writing; T008→T009 are sequential (env depends on keyring); T010 (schema) and T011 (fixture) are independent of the cipher/env chain.
- Each story's test tasks (T012–T015, T020–T022, T025–T027) are [P] within the story (distinct files).

---

## Parallel Example: User Story 1

```bash
# Write all US1 tests together first (they must fail before implementation):
Task: "Integration isolation test in server/tests/integration/note-isolation.test.ts"
Task: "Integration unauth test in server/tests/integration/note-protected.test.ts"
Task: "Contract isolation test in server/tests/contract/note-isolation.test.ts"
Task: "E2e isolation spec in e2e/note-isolation.spec.ts"

# Then implement sequentially (shared files): repo (T016) → routes (T017) → app wiring (T018) → update existing tests (T019)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup (script, env, DB reset).
2. Phase 2: Foundational (crypto + env validation + schema + fixture) — **blocks everything**.
3. Phase 3: User Story 1 — per-user ownership & isolation.
4. **STOP and VALIDATE**: two distinct users see only their own note; unauth → 401.
5. This is a usable, correct per-user note app (encrypted at rest by construction).

### Incremental Delivery

1. Setup + Foundational → base ready.
2. US1 → per-user ownership (MVP) → test → demo.
3. US2 → fail-closed + verified no-plaintext/round-trip → test → demo.
4. US3 → safe rotation (lazy + bulk CLI + retirement guard) → test → demo.
5. Polish → contract/README truth + full quickstart & rotation runbook validation.

Each story is an independently testable increment; commit after each task or logical group, and stop at any checkpoint to validate.

---

## Notes

- **[P]** = different files, no dependency on an incomplete task.
- **[Story]** label maps a task to US1/US2/US3 for traceability; Setup/Foundational/Polish carry none.
- Public HTTP contract **shapes are unchanged** — only semantics (caller's own note) and one new fail-closed error; `shared/src/api.ts` is not regenerated.
- **No new runtime dependency** — encryption uses Node's built-in `node:crypto`.
- **No client UI changes** — the existing note editor already drives GET/PUT `/api/note`.
- Secrets (`NOTE_ENC_KEYS`) live only in env: never in the DB, never sent to clients, never logged.
- Merge gates: tests pass **and** `tsc --noEmit` passes (Constitution Development Workflow).
