# Phase 0 Research: Store a Note

**Feature**: `001-store-notes` | **Date**: 2026-06-05

The spec left no `[NEEDS CLARIFICATION]` markers (both ambiguities were resolved during
`/speckit-clarify`). The open questions for planning were technology choices, each constrained by the
constitution (TypeScript end-to-end, TDD, Keep-It-Simple, accessible, small PRs) and the user's plan
constraints (single repo with `client/`+`server/`, OpenAPI contract, no auth). Decisions below.

## Decision 1 — Repository layout: npm workspaces (`client/`, `server/`, `shared/`)

- **Decision**: Single repo using npm workspaces with `client/`, `server/`, and a thin `shared/`
  package for contract-derived types.
- **Rationale**: Honors the user's `client/`+`server/` constraint. `shared/` lets both sides import
  one set of API types generated from the OpenAPI contract, satisfying "typed end to end" without
  duplicating type definitions. npm workspaces need no extra tooling (Node 22 ships with npm).
- **Alternatives considered**: Two unrelated package roots (rejected — no clean way to share the
  contract types); a monorepo tool like Turborepo/Nx (rejected — speculative overhead for a 3-package
  project, violates Keep-It-Simple).

## Decision 2 — Storage: SQLite via better-sqlite3

- **Decision**: SQLite, single file, accessed with better-sqlite3. One `note` table holding a single
  row.
- **Rationale**: The spec requires durability across page reloads and backend restarts (FR-003,
  SC-002). SQLite is the simplest durable option — no separate DB server, a single file on disk,
  synchronous API that is easy to use and test. For exactly one note, anything heavier is
  unjustified (Keep-It-Simple). Tests can use a temp-file or in-memory (`:memory:`) database.
- **Alternatives considered**: PostgreSQL (rejected — operational overhead unwarranted at this
  scale; revisit when accounts/multi-tenancy arrive); a JSON file on disk (rejected — concurrent
  writes and atomicity are easier and safer with SQLite); in-memory only (rejected — violates the
  durability requirement).

## Decision 3 — Server framework: Express 5 + Zod

- **Decision**: Express 5 for the HTTP layer; Zod to validate the request body and shape responses.
- **Rationale**: Express is the most widely understood Node framework with first-class TypeScript
  types — minimal surprise, minimal boilerplate for two routes. Zod gives runtime validation (FR-004
  empty/whitespace rejection, FR-008 length limit) co-located with TypeScript inference. The OpenAPI
  document remains the human-readable contract; Zod enforces the same rules at runtime.
- **Alternatives considered**: Fastify with JSON-schema-derived OpenAPI (rejected — would make code
  the contract source and risk drift from the hand-authored, reviewable `openapi.yaml`; also more
  framework concepts than needed); NestJS (rejected — far too much structure for two endpoints,
  violates Keep-It-Simple).

## Decision 4 — API contract as source of truth: OpenAPI + openapi-typescript

- **Decision**: `contracts/openapi.yaml` is the single source of truth. `openapi-typescript`
  generates `shared/src/api.ts`; client and server both import those types.
- **Rationale**: The user requires the contract documented in OpenAPI. Generating types from it means
  the documented contract and the compiled types cannot silently diverge, strengthening "typed end to
  end". Generation is a dev-time step with one small dependency.
- **Alternatives considered**: Hand-written shared types kept in sync manually (rejected — drift
  risk); generating server stubs/handlers from OpenAPI (rejected — heavier codegen than warranted).

## Decision 5 — Client: React 18 + Vite 5

- **Decision**: React 18 with Vite 5 and TypeScript for the SPA.
- **Rationale**: Conventional, well-documented default that the React Testing Library + jsdom stack
  tests well (accessibility-oriented queries support Principle IV). Vite gives fast dev/build with
  zero config. Provides a sound base for the richer deadman-switch UI planned later (contacts,
  liveness status).
- **Tradeoff noted**: For a single textarea + Save button, React is heavier than vanilla TS. Accepted
  deliberately for maintainability and future growth; no speculative abstraction is introduced now
  (the UI stays a single small component). Recorded in the plan's Constitution Check.
- **Alternatives considered**: Vanilla TS + Vite (rejected — marginally smaller now, but weaker
  foundation for the planned UI and fewer ergonomic testing utilities); Next.js (rejected — SSR/router
  features unneeded; violates Keep-It-Simple).

## Decision 6 — Testing strategy (satisfies Principle I, TDD)

- **Decision**: Vitest as the unified runner. Layers:
  - **Contract tests** (server): assert `GET`/`PUT` responses validate against `openapi.yaml`.
  - **Unit tests** (server): Zod validation rules; note repository (`getNote`, `upsertNote`).
  - **Integration tests** (server): Supertest over the Express app — happy paths, empty/whitespace
    rejection (FR-004), over-length rejection (FR-008), and persistence (write then read).
  - **Component tests** (client): React Testing Library + jsdom — empty state, render current note,
    edit+Save calls the API, error display, keyboard navigation/labels (Principle IV).
  - **E2E acceptance** (Playwright): save then reload shows persisted text (US1/SC-002); empty state
    on first visit; **unsaved-changes warning** on navigation/reload (FR-002a) — this browser-level
    `beforeunload` behavior cannot be verified in jsdom, so a real browser is required.
- **Rationale**: One runner (Vitest) keeps tooling minimal; Playwright is added only where a real
  browser is genuinely necessary. Each acceptance scenario in the spec maps to at least one test.
- **Alternatives considered**: Jest (rejected — Vitest is faster and native to the Vite/TS setup);
  skipping e2e (rejected — the reload-persistence and unsaved-warning scenarios are not observable
  without a browser, and Principle I requires them to be tested).

## Resolved unknowns

All Technical Context items are now concrete; no `NEEDS CLARIFICATION` remain.
