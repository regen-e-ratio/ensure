---
description: "Task list for Lean, Self-Maintaining README"
---

# Tasks: Lean, Self-Maintaining README

**Input**: Design documents from `/specs/003-readme-rework/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/readme-and-hook-contract.md, quickstart.md

**Tests**: Per Constitution Principle I (TDD, NON-NEGOTIABLE), the one piece of executable behavior in
this feature — the pre-commit hook's **relevance classifier** — has its test written *before* the
implementation (US2). The README and CLAUDE.md artifacts are prose (no executable behavior); their
acceptance is structural/onboarding verification against Contract A, not an automated unit test.

**Organization**: Tasks are grouped by the three user stories so each can be delivered and verified
independently. The three stories are mutually independent (README rewrite, enforcement hook,
contributor rule) and can be done in any order or in parallel.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (maps to spec.md user stories)
- Exact file paths are included in each task.

## Path Conventions

Repository root holds npm workspaces (`client/`, `server/`, `shared/`, `e2e/`). This feature adds
**no application code** — it touches `README.md`, `CLAUDE.md`, a new `.githooks/` hook, a `scripts/`
tooling helper + its test, and one line in root `package.json`.

---

## Phase 1: Setup (Shared Inputs)

**Purpose**: Establish the source-of-truth facts the README and the rule must reflect.

- [X] T001 Audit the current `README.md` and produce a keep/delete map: tag each existing section as one of the five allowed areas (Header, Architecture, Run, Manual Setup, Tests) or as bloat to delete (deadman-switch vision, scope in/out, redundant API table, standalone tech-stack list). Record in the PR description / working notes (research D4).
- [X] T002 [P] Capture the canonical current-state facts for the four content areas from the codebase: workspaces & responsibilities, server wiring (`server/src/app.ts`), auth/session model (`server/src/auth/*`, plan D1), SQLite tables (`server/src/db/index.ts`), the single Google external dependency, exact run/test commands (root `package.json`), and required env vars (`server/.env.example`, `server/src/config/env.ts`). These feed US1.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None. The three user stories are independent and share no blocking infrastructure
beyond the Setup inputs above.

**Checkpoint**: After Setup, US1 / US2 / US3 may each begin (in any order or in parallel).

---

## Phase 3: User Story 1 - Onboard from a single, accurate README (Priority: P1) 🎯 MVP

**Goal**: Replace the bloated README with a lean, fully self-contained document bounded to Header +
Architecture + Run + Manual Setup + Tests, accurate to the current system (notes app **with** Google
SSO).

**Independent Test**: From a fresh checkout, following only `README.md`, a developer reaches a
running app and a passing `npm test` with no undocumented step and no required outbound link
(SC-001, SC-002, SC-003, SC-005; Contract A).

### Implementation for User Story 1

> All tasks below edit the single file `README.md`, so they are sequential (no `[P]`).

- [X] T003 [US1] Rewrite the header in `README.md`: project name + one-line purpose only; remove badges/narrative (FR-001).
- [X] T004 [US1] Write the **Architecture** section in `README.md` in detail using the T002 facts: the four workspaces and their responsibilities; the request + auth flow (SPA → `/api/*`, `requireAuth` gating `/api/note`); the session model (Google OAuth 2.0 Authorization Code + PKCE → server-minted ~1h access JWT via `jose` + opaque hashed refresh token with 24h sliding inactivity, httpOnly/Secure/SameSite=Lax cookies, client silent refresh on 401); the better-sqlite3 store with `note`/`user`/`session` tables; and the single external service (Google OAuth) (FR-002).
- [X] T005 [US1] Write the **Run** section in `README.md` with exact ordered commands: `npm install`, `npm run gen:api`, `npm run dev:server` (http://localhost:3000, SQLite at `./data/note.db`), `npm run dev:client` (http://localhost:5173, proxies `/api` → :3000) (FR-003).
- [X] T006 [US1] Write the **Manual Setup** section in `README.md`: how to create a Google OAuth 2.0 Web client (authorized redirect URI `http://localhost:3000/api/auth/google/callback`); create `server/.env` (git-ignored) with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and a generated `AUTH_JWT_SECRET` (show the `node -e` generator command, not a value); note the test-only `AUTH_TEST_MODE=1` / `NOTE_ALLOW_TEST_RESET=1`. Include **no** real secret values (FR-004, FR-005; data-model Entity 2).
- [X] T007 [US1] Write the **Tests** section in `README.md`: `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:e2e` (with `PW_CHANNEL=chrome` fallback and `AUTH_TEST_MODE=1` note), plus the merge quality gates (tests + typecheck pass; UI accessibility baseline) (FR-006).
- [X] T008 [US1] Delete all out-of-scope content from `README.md` and verify Contract A: every top-level heading maps 1:1 to one of the five sections; the README is self-contained (no required outbound links, FR-012); contains no secret values (FR-005); reflects current state (FR-011). Then run the onboarding acceptance from a clean checkout following only the README (SC-001).

**Checkpoint**: README satisfies Contract A and onboards a newcomer to run + tests using only itself. **MVP deliverable.**

---

## Phase 4: User Story 2 - Trust the README to be current (Priority: P2)

**Goal**: A local git pre-commit hook warns when staged changes touch README-relevant areas without
a corresponding `README.md` change, so the README never silently drifts (FR-013).

**Independent Test**: Committing a change to a README-relevant path without staging `README.md`
triggers the hook's warning + soft block; a commit touching only irrelevant paths (e.g., `specs/**`)
proceeds silently; `git commit --no-verify` always proceeds (SC-007; Contract B).

### Tests for User Story 2 (write FIRST, must FAIL before implementation) ⚠️

- [X] T009 [P] [US2] Write a failing table-driven unit test for the relevance classifier in `scripts/__tests__/readme-relevance.test.mjs` (Node built-in `node --test`, no new dependency). Cases: `server/src/auth/routes.ts` → relevant; `package.json` → relevant; `client/src/styles.css` → relevant; `[README.md, server/src/x.ts]` staged → **not** flagged (README present); `specs/003-readme-rework/plan.md` only → not relevant; empty set → not relevant (research D6; Contract B acceptance).

### Implementation for User Story 2

- [X] T010 [US2] Implement the pure relevance classifier in `scripts/readme-relevance.mjs`: export a function `(stagedPaths: string[]) => { relevant: boolean, triggers: string[] }` using the relevance globs (`server/src/**`, `client/src/**`, `shared/src/**`, `contracts/**`, `e2e/**`, `playwright.config.ts`, `eslint.config.js`, `tsconfig*.json`, `package.json`, `*/package.json`, `**/.env.example`); `relevant` is false when `README.md` is among staged paths. Make T009 pass (data-model Entity 4; research D3).
- [X] T011 [US2] Give `scripts/readme-relevance.mjs` a CLI mode (read staged paths from stdin or `process.argv`): when relevant, print a warning naming the triggering files and the four areas + how to proceed (update README or `--no-verify`) and exit `1`; otherwise exit `0` (Contract B behavior table).
- [X] T012 [US2] Create `.githooks/pre-commit` (POSIX `sh`, executable): run `git diff --cached --name-only | node "$(git rev-parse --show-toplevel)/scripts/readme-relevance.mjs"` and propagate its exit code. Keep it thin (research D2/D3; <1s, no network).
- [X] T013 [US2] Activate the hook: add `"prepare": "git config core.hooksPath .githooks || true"` to the root `package.json` scripts (best-effort so non-git installs don't fail), add a `"test:hooks": "node --test scripts/__tests__/"` script, and include it in the root `"test"` so `npm test` runs the classifier test (Constitution I / CI gate). Run `git config core.hooksPath .githooks`, then manually verify SC-007: (a) stage a `server/src/**` edit without README → blocked; (b) stage only `specs/**` → passes; (c) `--no-verify` → passes (research D2; Contract B acceptance).

**Checkpoint**: The hook keeps the README honest; `npm test` covers the classifier.

---

## Phase 5: User Story 3 - A standing rule keeps the README lean over time (Priority: P3)

**Goal**: `CLAUDE.md` carries a durable rule defining the README's fixed scope and the
update-only-if-relevant discipline, surviving Spec Kit agent-context refreshes (FR-010).

**Independent Test**: A contributor reading `CLAUDE.md` can correctly restate what the README may
contain and the rule for when to update it, without seeing this spec (SC-006).

### Implementation for User Story 3

- [X] T014 [US3] Add a `## README maintenance` section to `CLAUDE.md` placed **after** the `<!-- SPECKIT END -->` marker (outside the managed block, so agent-context updates never clobber it): state the five allowed areas; the update-iff-relevant rule (update README only when a change affects architecture/run/manual-setup/tests); the leave-alone rule (otherwise no README edits); the no-bloat / no-secret-values constraints; and a pointer to `.githooks/pre-commit` (FR-010; research D5; data-model Entity 3).
- [X] T015 [US3] Verify the rule is outside the `<!-- SPECKIT START/END -->` block and that it unambiguously conveys scope + update trigger (SC-006).

**Checkpoint**: The leanness discipline is codified for future human and AI contributors.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T016 Run the `specs/003-readme-rework/quickstart.md` end-to-end verification (README onboarding + hook two-case check + `npm test`).
- [X] T017 [P] Leanness review (SC-005): confirm the reworked `README.md` is meaningfully leaner in non-essential content than the prior version while being complete on the four essential areas (no loss of required operational info).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Empty (no blocking work).
- **User Stories (Phase 3–5)**: Each depends only on Setup. They are mutually independent and may run in parallel or in any order.
- **Polish (Phase 6)**: After the user stories you intend to ship are complete.

### User Story Dependencies

- **US1 (P1)**: Depends on Setup (T002 facts). Independent of US2/US3. → MVP.
- **US2 (P2)**: Depends on Setup only. Independent of US1/US3 (the hook references `README.md` but functions regardless of its content).
- **US3 (P3)**: Depends on Setup only. Independent of US1/US2.

### Within Each User Story

- **US1**: T003→T004→T005→T006→T007→T008 sequential (all edit `README.md`).
- **US2**: T009 (failing test) → T010 (classifier) → T011 (CLI) → T012 (hook) → T013 (activate + verify).
- **US3**: T014 → T015.

### Parallel Opportunities

- **Setup**: T002 `[P]` alongside T001.
- **Across stories**: With multiple people, US1, US2, and US3 can proceed simultaneously after Setup (they touch disjoint files: `README.md` vs `scripts/`+`.githooks/`+`package.json` vs `CLAUDE.md`).
- **US2**: T009 `[P]` (its own new test file) can be written while Setup finishes.
- **Polish**: T017 `[P]`.

---

## Parallel Example: across user stories (after Setup)

```bash
# Three independent tracks, disjoint files:
Track A (US1): rewrite README.md            # T003–T008
Track B (US2): scripts/ + .githooks/ + package.json   # T009–T013
Track C (US3): CLAUDE.md                     # T014–T015
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup (T001–T002).
2. Phase 3 US1 (T003–T008) — rewrite the README.
3. **STOP and VALIDATE**: onboard from a clean checkout using only the README (SC-001). This alone delivers the core value.

### Incremental Delivery

1. Setup → US1 (lean, accurate README — MVP) → validate.
2. Add US2 (pre-commit hook keeps it current) → validate SC-007.
3. Add US3 (CLAUDE.md rule codifies the discipline) → validate SC-006.

Each story adds value without breaking the others.

---

## Notes

- `[P]` = different files, no dependencies. Tasks that edit the same file (all of US1 on `README.md`) are sequential.
- The only automated test is the relevance classifier (T009, wired into `npm test` via T013); prose artifacts are verified structurally (Contract A) and by onboarding (SC-001).
- No new runtime/dev dependencies are introduced (Node's built-in `node --test`, git, POSIX `sh`).
- Never write real secret values into `README.md` (FR-005).
- Commit after each task or logical group; for commits touching README-relevant paths once the hook is live, stage `README.md` too or use `--no-verify` deliberately.
