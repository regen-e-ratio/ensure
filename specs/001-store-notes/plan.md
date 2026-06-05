# Implementation Plan: Store a Note

**Branch**: `001-store-notes` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-store-notes/spec.md`

## Summary

Build a small full-stack web app that maintains a **single, durably-stored text note** that anyone
visiting the app can read and edit in place. The browser client shows the current note text (or an
empty state), lets the person edit it in a textarea, and persists it to the backend via an explicit
**Save** action; navigating away with unsaved edits triggers a warning. The backend exposes a tiny
HTTP API (`GET`/`PUT` a single note) documented in OpenAPI and persists the note in a database so it
survives reloads and server restarts. No accounts or authentication in this version — the note is a
single shared resource. This is the foundation for a future "deadman switch" application.

## Technical Context

**Language/Version**: TypeScript 5.6+ on Node.js 22 LTS (server) and modern evergreen browsers (client)

**Primary Dependencies**:
- Server: Express 5, Zod (request/response validation), better-sqlite3 (storage driver)
- Client: React 18 + Vite 5
- Shared: `openapi-typescript` to generate shared API types from the OpenAPI contract (single source
  of truth → "typed end to end")

**Storage**: SQLite (single file, via better-sqlite3). A single-row `note` table. Chosen for zero
operational overhead, durability across restarts, and trivial test setup (file or in-memory DB).

**Testing**: Vitest (server unit + integration via Supertest; client component tests via React
Testing Library + jsdom); Playwright for end-to-end acceptance tests that require a real browser
(persistence across reload, unsaved-changes warning).

**Target Platform**: Linux server (Node process) + browser SPA. Local dev and single-instance deploy.

**Project Type**: Web application (single repo with `client/` and `server/`, plus a small `shared/`
for contract-derived types).

**Performance Goals**: Save reflected as current note within 2 s (SC-003); API p95 < 200 ms locally.
Trivial scale — exactly one note.

**Constraints** (from user input + spec):
- Single repo, `client/` and `server/` folders.
- API contract documented in OpenAPI (`contracts/openapi.yaml` is the source of truth).
- No authentication in this version (spec out-of-scope).
- Plain text only; max 10,000 characters; single shared note; last-write-wins on concurrent saves.

**Scale/Scope**: One note, two endpoints, one screen. Foundation intended to grow toward a deadman
switch (contacts, liveness check, sharing) in later features.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|-----------|--------|----------------------------|
| I | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Tests written before/with code at every layer: contract tests (API vs OpenAPI), server unit tests (validation, repository), client component tests, and Playwright e2e for the acceptance scenarios (reload persistence, empty state, unsaved-changes warning). All wired into CI; merge blocked unless green. |
| II | Keep It Simple | ✅ PASS (with note) | SQLite single-row table, two endpoints (`GET`/`PUT`), one screen, no auth, no list/history. **Note:** React+Vite is heavier than strictly required for one textarea; chosen deliberately for maintainability and as the base for the planned deadman-switch UI. Not a violation — no speculative abstraction is added; see Complexity Tracking (none required). |
| III | Typed End to End | ✅ PASS | TypeScript on client and server. API types are generated from `contracts/openapi.yaml` via `openapi-typescript` and shared by both sides, so request/response shapes are typed from one contract. `any` avoided; `tsc --noEmit` runs in CI. |
| IV | Accessible by Default | ✅ PASS | Semantic HTML form: `<label>` bound to the `<textarea>`, a real `<button>` for Save, focus-visible styles, status/error messages via an `aria-live` region, last-updated as readable text, WCAG AA contrast. Keyboard-only flow verified in component/e2e tests. |
| V | Small Pull Requests | ✅ PASS | Work sliced by user story (US1 save+persist, US2 view+revise+unsaved-warning) and by layer; the contract + scaffolding land first, then each story is an independently mergeable increment. |

**Merge gates** (from constitution Development Workflow): a PR merges only when (1) tests pass,
(2) `tsc` type-check passes, and (3) UI changes meet the accessibility baseline. All three are
encoded as CI checks.

**Result**: PASS. No violations requiring justification → Complexity Tracking left empty.

**Post-design re-check (after Phase 1)**: Still PASS. The data model (one `note` row), the contract
(two endpoints), the OpenAPI-generated shared types, and the single `NoteEditor` component add no new
abstraction or dependency beyond what is justified above; all five principles remain satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/001-store-notes/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Feature specification
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── openapi.yaml      # API contract — single source of truth
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
contracts/
└── openapi.yaml             # Runtime copy of the API contract (synced from spec contracts/)

shared/
└── src/
    ├── api.ts               # Types GENERATED from contracts/openapi.yaml (do not hand-edit)
    └── constants.ts         # NOTE_MAX_LENGTH = 10000, shared validation constants

server/
├── src/
│   ├── app.ts               # Express app factory (testable; no listen)
│   ├── server.ts            # Entry point: creates app + listens
│   ├── routes/
│   │   └── note.ts          # GET /api/note, PUT /api/note
│   ├── db/
│   │   ├── index.ts         # better-sqlite3 connection + migration (create note table)
│   │   └── note-repo.ts     # getNote(), upsertNote(text)
│   └── validation/
│       └── note.ts          # Zod schema for note payload (non-empty, <= NOTE_MAX_LENGTH)
└── tests/
    ├── contract/            # API responses validated against openapi.yaml
    ├── integration/         # Supertest: GET/PUT happy + error paths, persistence
    └── unit/                # validation + repository unit tests

client/
├── src/
│   ├── main.tsx             # React entry
│   ├── App.tsx              # Composition + state
│   ├── components/
│   │   └── NoteEditor.tsx   # textarea + Save button + status/last-updated + empty state
│   ├── hooks/
│   │   └── useUnsavedGuard.ts  # beforeunload warning when dirty
│   └── api/
│       └── noteClient.ts    # fetch wrappers typed via shared/api.ts
└── tests/
    └── components/          # React Testing Library component tests

e2e/
└── note.spec.ts             # Playwright: save → reload persists; empty state; unsaved-changes warning
```

**Structure Decision**: Web application layout in a single repo using **npm workspaces** with
`client/`, `server/`, and `shared/` (the user asked for `client/` and `server/`; `shared/` is a thin
package that holds the OpenAPI-generated API types so both sides import one contract-derived source —
this directly serves the "typed end to end" principle). End-to-end acceptance tests live in a
top-level `e2e/` folder because they exercise the client and server together in a real browser.

## Complexity Tracking

> No constitution violations — this section intentionally left empty.
