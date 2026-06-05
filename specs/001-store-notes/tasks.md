---
description: "Task list for Store a Note (001-store-notes)"
---

# Tasks: Store a Note

**Input**: Design documents from `/specs/001-store-notes/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/openapi.yaml

**Tests**: MANDATORY. Per Constitution Principle I (Test-Driven Development, NON-NEGOTIABLE), every
user story includes test tasks written **before** its implementation tasks; those tests MUST fail
first, then pass once the implementation lands.

**Organization**: Tasks are grouped by user story so each story is an independently testable
increment. US1 is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 (Setup, Foundational, and Polish tasks carry no story label)
- File paths are relative to the repository root

## Path Conventions

Single repo, npm workspaces: `client/`, `server/`, `shared/`, plus top-level `e2e/` and
`contracts/`. Layout per `plan.md` → Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the workspace skeleton and shared tooling.

- [X] T001 Create the workspace directory structure (`client/`, `server/src/`, `shared/src/`, `e2e/`, `contracts/`) at the repository root per plan.md
- [X] T002 Add root `package.json` configuring npm workspaces `["shared", "server", "client"]` and root scripts (`dev`, `build`, `test`, `typecheck`, `test:e2e`, `gen:api`)
- [X] T003 [P] Add `tsconfig.base.json` (strict, no implicit `any`) and per-workspace `tsconfig.json` extending it
- [X] T004 [P] Add ESLint + Prettier config and a `lint` script at the repo root
- [X] T005 [P] Place the API contract at `contracts/openapi.yaml` (copy of `specs/001-store-notes/contracts/openapi.yaml`) as the runtime source of truth

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Persistence, shared types, server/client scaffolding, and test harnesses that ALL user
stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 [P] Add `shared/src/constants.ts` exporting `NOTE_MAX_LENGTH = 10000` (per data-model.md)
- [X] T007 Add `openapi-typescript` dev dependency and `gen:api` script; generate `shared/src/api.ts` from `contracts/openapi.yaml` (depends on T005) — generated file, never hand-edited
- [X] T008 Implement SQLite connection + startup migration creating the singleton `note` table (`CHECK (id = 1)`) in `server/src/db/index.ts` (schema per data-model.md)
- [X] T009 Implement the note repository `getNote()` and `upsertNote(text)` in `server/src/db/note-repo.ts` (depends on T008)
- [X] T010 Create the Express app factory in `server/src/app.ts` mounting an empty `/api` note router from `server/src/routes/note.ts`, plus the entry point `server/src/server.ts` (no `listen` in `app.ts`, so it is testable)
- [X] T011 [P] Create the typed API client (`getNote`, `putNote`) in `client/src/api/noteClient.ts` using types from `shared/src/api.ts` (depends on T007)
- [X] T012 [P] Create the React app shell (`client/src/main.tsx`, `client/src/App.tsx` mounting a `NoteEditor` placeholder) and `client/vite.config.ts` with an `/api` dev proxy to the server
- [X] T013 [P] Configure Vitest for the `server` (node env) and `client` (jsdom env + React Testing Library) workspaces
- [X] T014 [P] Configure Playwright in `e2e/` (config + browser install) for acceptance tests

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Write and save my note (Priority: P1) 🎯 MVP

**Goal**: A person can type text and persist it as the note via an explicit Save; it survives page
reload and backend restart.

**Independent Test**: Open the app with no note, type text, press Save, reload the page (and restart
the server) → the saved text is still present.

### Tests for User Story 1 (write FIRST — must fail before implementation) ⚠️

- [X] T015 [P] [US1] Contract test: `PUT /api/note` request/response conforms to `contracts/openapi.yaml` in `server/tests/contract/put-note.test.ts`
- [X] T016 [P] [US1] Integration tests (Supertest) for `PUT /api/note` in `server/tests/integration/put-note.test.ts`: happy save returns `200 { note }`; empty/whitespace-only → `400` (FR-004); text > 10000 chars → `400` (FR-008); after save, `getNote()` returns the persisted text (SC-002)
- [X] T017 [P] [US1] Unit test for the Zod note-input validation (non-empty after trim, max length) in `server/tests/unit/note-validation.test.ts`
- [X] T018 [P] [US1] Component test: typing then pressing Save calls `putNote`, shows a success status, and shows an error on failure in `client/tests/components/NoteEditor.save.test.tsx`
- [X] T019 [P] [US1] E2E (Playwright): write a note, Save, reload → text persists in `e2e/note-save.spec.ts`

### Implementation for User Story 1

- [X] T020 [P] [US1] Implement the Zod `NoteInput` schema (non-empty after trim, ≤ `NOTE_MAX_LENGTH`, preserves verbatim value) in `server/src/validation/note.ts`
- [X] T021 [US1] Implement the `PUT /api/note` handler (validate → `upsertNote` → `200 { note }`, or `400 { error, message }`) in `server/src/routes/note.ts` (depends on T009, T020)
- [X] T022 [US1] Implement `NoteEditor` save UI — `<label>` + `<textarea>` + Save `<button>` + `aria-live` status/error region (semantic, keyboard-navigable, WCAG AA) in `client/src/components/NoteEditor.tsx` (depends on T011)
- [X] T023 [US1] Wire the Save flow in `client/src/App.tsx` (call `putNote`, surface success/error) (depends on T022)

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP.

---

## Phase 4: User Story 2 - Review and revise my note (Priority: P2)

**Goal**: On return, the current note text and last-updated time are shown (or an empty state);
editing and saving replaces the text in place; leaving with unsaved edits triggers a warning.

**Independent Test**: With a note saved, load the app → current text + last-updated shown; change and
Save → reload shows updated text; edit without saving and attempt to reload → unsaved-changes warning.

> Note: US2 shares files with US1 (`server/src/routes/note.ts`, `client/src/App.tsx`,
> `client/src/components/NoteEditor.tsx`) and naturally builds on the MVP. Build US1 first.

### Tests for User Story 2 (write FIRST — must fail before implementation) ⚠️

- [X] T024 [P] [US2] Contract test: `GET /api/note` response conforms to `contracts/openapi.yaml` for both the note and `null` cases in `server/tests/contract/get-note.test.ts`
- [X] T025 [P] [US2] Integration tests (Supertest) for `GET /api/note` in `server/tests/integration/get-note.test.ts`: returns `{ note: null }` when empty (FR-005); returns the saved note with `createdAt`/`updatedAt` (FR-007)
- [X] T026 [P] [US2] Component test: loads and displays the current note + last-updated; shows the empty state when `null`; editing replaces the displayed text in `client/tests/components/NoteEditor.view.test.tsx`
- [X] T027 [P] [US2] Unit test: `useUnsavedGuard` arms the `beforeunload` warning only while there are unsaved edits in `client/tests/components/useUnsavedGuard.test.ts`
- [X] T028 [P] [US2] E2E (Playwright): empty state on first visit; edit existing note replaces it after reload; unsaved-changes warning on reload (FR-002a) in `e2e/note-view.spec.ts`

### Implementation for User Story 2

- [X] T029 [US2] Implement the `GET /api/note` handler (`getNote()` → `200 { note: Note | null }`) in `server/src/routes/note.ts` (depends on T009; same file as T021 → after US1)
- [X] T030 [P] [US2] Implement the `useUnsavedGuard` hook (arms/disarms `window` `beforeunload` based on a dirty flag) in `client/src/hooks/useUnsavedGuard.ts`
- [X] T031 [US2] Extend `App`/`NoteEditor` to load the current note on mount, render last-updated and the empty state, track dirty state, and wire `useUnsavedGuard` in `client/src/App.tsx` and `client/src/components/NoteEditor.tsx` (depends on T022, T023, T030)

**Checkpoint**: Both user stories work; the full single-note view/edit/save/persist flow is complete.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Cross-cutting quality, docs, and the constitution merge gates.

- [X] T032 [P] Add a root `README.md` summarizing setup/run/test (mirror `quickstart.md`)
- [X] T033 [P] Accessibility pass on `NoteEditor`: keyboard-only flow, label association, focus-visible styles, WCAG AA contrast (Constitution Principle IV) in `client/src/components/NoteEditor.tsx`
- [X] T034 [P] Add CI workflow running `typecheck` + unit/integration/component tests + Playwright e2e as merge gates in `.github/workflows/ci.yml`
- [X] T035 Run the `quickstart.md` flow end-to-end and confirm all acceptance scenarios pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–4)**: Depend on Foundational. US1 (P1) first as the MVP; US2 (P2) builds
  on US1's shared files.
- **Polish (Phase 5)**: Depends on the desired user stories being complete.

### Key task-level dependencies

- T007 (gen types) depends on T005 (contract present).
- T009 (repo) depends on T008 (db). T021 (PUT) depends on T009 + T020 (validation).
- T011 (client API) depends on T007. T022 (NoteEditor) depends on T011; T023 depends on T022.
- T029 (GET) edits the same file as T021 → sequence after US1. T031 depends on T022/T023/T030.

### Within each user story

- Tests are written and FAIL before implementation (Constitution Principle I).
- Server: validation/repo → route handler. Client: API client → component → app wiring.

### Parallel Opportunities

- Setup: T003, T004, T005 in parallel.
- Foundational: T006, T011, T012, T013, T014 in parallel (T008→T009 and T007 are sequential per deps).
- US1 tests T015–T019 all in parallel; US2 tests T024–T028 all in parallel.
- T020 and T030 are parallelizable within their stories.

---

## Parallel Example: User Story 1

```bash
# Write all US1 tests first (they must fail):
Task: "Contract test PUT /api/note in server/tests/contract/put-note.test.ts"
Task: "Integration tests PUT /api/note in server/tests/integration/put-note.test.ts"
Task: "Unit test note validation in server/tests/unit/note-validation.test.ts"
Task: "Component test NoteEditor save in client/tests/components/NoteEditor.save.test.tsx"
Task: "E2E save+reload persists in e2e/note-save.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (US1): write failing tests, then implement until green.
3. **STOP and VALIDATE**: a person can write, save, and reload to find the note persisted.
4. Deploy/demo the MVP.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → test → deploy/demo (MVP: durable single note via Save).
3. US2 → test → deploy/demo (view current note, empty state, last-updated, unsaved-changes warning).
4. Polish (CI gates, a11y pass, docs).

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- Tests are mandatory and precede implementation (constitution); verify they fail first.
- Keep PRs small — one user story (or a coherent slice) per PR (Constitution Principle V).
- Merge gate: `typecheck` + all tests + e2e pass, and UI meets the accessibility baseline.
- No auth, no list, no history, no delete in this version (per spec scope).
