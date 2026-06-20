# Implementation Plan: Liveness Engine, Check-in & Status Dashboard

**Branch**: `feat/deadman-switch` (feature `008-deadman-engine-checkin`) | **Date**: 2026-06-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-deadman-engine-checkin/spec.md`

## Summary

Add the **liveness engine** that turns Ensure into a working dead-man switch. Each user gets a
per-user **state machine** — `disarmed → active → grace → triggered` — backed by a new
**`deadman_config`** row (one per user) and an append-only **`deadman_event`** audit log. A new
backend module **`server/src/deadman/`** holds a **pure `evaluate(config, now)`** decision function and
**`runDeadmanTick(db, deps, now)`** that applies decisions through **injected `deps`** (a notifier + a
clock) so it is fully unit-testable and **idempotent**. The tick is driven by an in-process
`setInterval` (`driver.ts` → `startDeadmanTimer`, default 60 000 ms, guarded by
`DEADMAN_TICK_DISABLED`) wired into `server.ts` boot and **recovered on boot**, and is also exposed as
`npm run deadman:tick` (`server/src/cli/deadman-tick.ts`) for an external cron.

The HTTP surface gains three authed operations under `/api/deadman`: `GET /api/deadman` (status incl.
`secondsUntilDue`), `PUT /api/deadman/config` (interval, grace, `enabled` ⇒ arm/disarm), and
`POST /api/deadman/checkin` — defined in `contracts/openapi.yaml`, surfaced to both sides via generated
`shared/src/api.ts`, with interval/grace **bounds + defaults** in `shared/src/constants.ts`. A test seam
`POST /api/test/deadman` (gated by `DEADMAN_TEST_MODE=1`) fast-forwards a switch's deadlines into the
past for e2e. The client gets `deadmanClient.ts` and a **dashboard page** (state badge, live countdown,
big "I'm alive" check-in button, interval/grace config form, arm/disarm with confirm-before-first-arm,
recent-events list), plus a nav link from the note page header — following the existing
`NoteEditor`/`ContactList` state-machine + a11y patterns.

In 008, grace-expiry transitions to `triggered` and records the event so the engine is complete and
testable end to end; **actual release to verified contacts is feature 010**. Grace reminders go to the
**user's own account email** via the generic `notify()` dispatcher.

## Technical Context

**Language/Version**: TypeScript 5.6+ on Node.js 22 (server, run via `tsx`, ESM) and the browser SPA
(client); unchanged from 001/002/004/006.

**Primary Dependencies**: Express 5, Zod, better-sqlite3 (server); React 18 + React Router (client);
the existing `notify()` dispatcher + email channel (feature 005). **No new runtime dependency** — the
scheduler is the built-in `setInterval`/`setTimeout`; IDs use `node:crypto.randomUUID()`; the clock is
`Date` injected via `deps`. (KISS — no job-queue library, per roadmap §1 and §6.)

**Storage**: Existing SQLite DB (better-sqlite3). **Two new tables** created in `openDb()`:
`deadman_config` (PK `user_id`, with `idx_deadman_state_due` on `(state, next_checkin_due_at)`) and
append-only `deadman_event` (with `idx_deadman_event_user` on `(user_id, created_at)`). `user`,
`session`, `note`, `contact` tables are unchanged. No note plaintext or token is ever stored in either
new table (FR-017).

**Testing**: Vitest (server unit + contract via Supertest; client via React Testing Library) and
Playwright e2e — all already configured. New tests: engine unit tests (`evaluate` for every transition;
`runDeadmanTick` with an injected clock + spy notifier; idempotency / no double-fire), repo unit tests
(`config-repo` upsert/checkin/setState/listDue scoping; `event-repo` append + per-user list ordering),
contract tests for `GET /api/deadman`, `PUT /api/deadman/config` (arm/disarm/bounds), and
`POST /api/deadman/checkin` (+ `401` + isolation), client component tests for the dashboard, and an e2e
spec (arm → check-in → status; miss-deadline via the `DEADMAN_TEST_MODE` seam → grace). **All tests set
`DEADMAN_TICK_DISABLED=1`** so the in-process timer never runs (FR-015, SC-008).

**Target Platform**: Linux server (single Node process) + existing browser SPA, single-instance deploy.

**Project Type**: Web application (existing npm workspaces `client/`, `server/`, `shared/`).

**Performance Goals**: A tick selects only **due** switches via the `(state, next_checkin_due_at)`
index, so it is O(due rows), sub-millisecond at this scale. No change to the existing local p95 < 200 ms
target for the synchronous endpoints.

**Constraints**:
- Deadlines are **absolute ISO-8601 timestamps** so restarts never lose time or fire early (FR-014).
- The engine performs **no I/O except through injected `deps`** (notifier + clock); `evaluate` is pure
  (FR-008, FR-009).
- The tick is **idempotent + state-guarded**: re-running (timer and cron together) never double-sends
  beyond the reminder cap nor re-triggers (FR-013).
- Reminders use the **generic `notify()`** dispatcher to the **user's own email**; providers are never
  called directly (roadmap conventions).
- Interval ∈ [1 h, 365 d], grace ∈ [1 h, 30 d]; defaults interval 7 d / grace 2 d (FR-003, FR-021).
- The in-process timer is **off** when `DEADMAN_TICK_DISABLED=1`; tests must set it (FR-015, SC-008).
- No note plaintext / token / secret in any event detail, response, or log (FR-017).
- The `DEADMAN_TEST_MODE` seam is mounted **only** behind its env gate (same pattern as
  `AUTH_TEST_MODE`/`NOTE_ALLOW_TEST_RESET`) — never in production (FR-020).

**Scale/Scope**: Small number of users, one switch each. New: two tables; a `deadman/` module
(`engine.ts`, `config-repo.ts`, `event-repo.ts`, `driver.ts`); a `deadman` route + test seam; a CLI +
npm script; new env vars; a `deadmanClient.ts`, a dashboard page, a nav link, and styles; OpenAPI
additions + shared bounds; and tests at every layer.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|-----------|--------|----------------------------|
| I | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Tests written with/before code at every layer. **Unit (engine)** — `evaluate` returns the right decision for each transition (active→stay, active→grace+reminder, grace→reminder, grace→active on check-in, grace→triggered, disarmed/triggered→noop); `runDeadmanTick` with an **injected clock + spy notifier** asserts state, deadlines, events, and the reminder cap, and **re-running the tick is a no-op** (idempotency). **Unit (repos)** — `config-repo` upsert/recordCheckin/setState/listDue (user-scoped, due-selection) and `event-repo` append + newest-first per-user list. **Contract (Supertest)** — `GET /api/deadman` (status + `secondsUntilDue`), `PUT /api/deadman/config` (arm, disarm, out-of-bounds 400), `POST /api/deadman/checkin` (resets deadline; rejects when disarmed/triggered), `401` for each, and two-user isolation. **Client** — dashboard renders each state badge, countdown, check-in, config form, first-arm confirm, events list, and error/loading states. **e2e** — arm → check-in → status, and miss-deadline via the test seam → grace. All wired into CI; merge blocked unless green. Tests set `DEADMAN_TICK_DISABLED=1`. |
| II | Keep It Simple | ✅ PASS | Smallest design meeting the spec: **no scheduler library** — a single `setInterval` wrapper (`driver.ts`) + a pure tick that the CLI also calls; **no distributed lock** — single-instance + state-guarded idempotency suffices (roadmap §6); **no new dependency** (`randomUUID`, `Date`, `setInterval` are built in). Two tables, one module, one route, one client page — each mirroring an existing counterpart (`note`/`contact`). Bounds/defaults are required by FR-003/FR-021, not speculative. The `evaluate`/`runDeadmanTick` split exists to make the engine pure and testable (a present TDD requirement), not for hypothetical futures. → Complexity Tracking left empty. |
| III | Typed End to End | ✅ PASS | `DeadmanStatus`, `DeadmanConfigInput`, `DeadmanEvent`, and the events-list response are defined once in `contracts/openapi.yaml`, generated into `shared/src/api.ts` (`npm run gen:api`), and consumed by both client (`deadmanClient.ts`) and server (`routes/deadman.ts`, repos, engine via `components["schemas"]`). Input validated with Zod returning the existing `ParseResult` discriminated union. The engine's `Deps` (notifier + clock) and `evaluate` decision are explicit union types. `any` avoided; `tsc --noEmit` in CI. |
| IV | Accessible by Default | ✅ PASS | The dashboard is keyboard-navigable and semantic: the state is a labelled badge; the countdown uses `role="status"` `aria-live="polite"`; the big "I'm alive" control is a real `<button>` with an accessible name; the config form has `<label htmlFor>`-bound number inputs for interval/grace with min/max; arm/disarm is a labelled control with a confirm dialog before the first arm; errors use `role="alert"`; the recent-events list is a semantic `<ul>/<li>`. Mirrors `NoteEditor`/`ContactList`. WCAG AA contrast inherited from existing styles + any new badge classes. |
| V | Small Pull Requests | ✅ PASS | Sliced into independently reviewable steps: **(1)** contract + shared bounds + tables + repos + engine + driver + CLI + server tests; **(2)** `/api/deadman` route + test seam + route/contract tests + server.ts wiring; **(3)** client dashboard page + `deadmanClient.ts` + nav link + client tests; **(4)** e2e spec + README (Architecture/Run/Manual-setup/Tests) updates. Each is reviewable in one sitting and committed as its own bisectable `feat:` commit on the single feature branch (per roadmap §5). |

**Merge gates** (constitution Development Workflow): a PR merges only when (1) tests pass,
(2) `tsc` type-check passes, and (3) the new UI meets the accessibility baseline.

**Result**: PASS. No violations requiring justification → Complexity Tracking left empty.

**Post-design re-check (after Phase 1)**: Still PASS. The two tables, the `deadman/` module, the route,
and the dashboard add no abstraction beyond what the spec demands. The pure-`evaluate`/`runDeadmanTick`
split, the injected `deps`, and the absolute-timestamp clock model are each mandated by explicit
requirements (FR-008/FR-009 testable engine, FR-013 idempotency, FR-014 restart-safety), so none is
unjustified complexity. No scheduler library, no distributed lock. All five principles remain satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/008-deadman-engine-checkin/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification (+ Clarifications)
├── research.md          # Phase 0 output — decisions (engine purity, driver, idempotency, bounds)
├── data-model.md        # Phase 1 output — deadman_config + deadman_event + state machine
├── quickstart.md        # Phase 1 output — run the engine, arm/check-in, fast-forward via the seam
├── contracts/
│   └── deadman-api.md   # Phase 1 — HTTP contract for GET /deadman, PUT /deadman/config, POST /deadman/checkin
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root) — additions/changes to the existing layout

```text
contracts/openapi.yaml                  # ADD: /deadman, /deadman/config, /deadman/checkin paths;
                                        #      DeadmanStatus, DeadmanConfigInput, DeadmanEvent,
                                        #      DeadmanEventListResponse schemas (Note/Contact style)

shared/src/
├── constants.ts                        # ADD: CHECKIN_INTERVAL_MIN/MAX_SECONDS, GRACE_PERIOD_MIN/MAX_SECONDS,
│                                        #      DEADMAN_DEFAULT_INTERVAL_SECONDS, DEADMAN_DEFAULT_GRACE_SECONDS,
│                                        #      DEADMAN_MAX_GRACE_REMINDERS
├── index.ts                            # ADD: re-export the new constants
└── api.ts                              # REGENERATED via `npm run gen:api` from openapi.yaml

server/
├── src/
│   ├── config/
│   │   └── env.ts                      # ADD: read DEADMAN_TICK_MS, DEADMAN_TICK_DISABLED, APP_BASE_URL,
│   │                                    #      DEADMAN_TEST_MODE (where EMAIL_PROVIDER is read / a Deadman config)
│   ├── server.ts                       # WIRE: startDeadmanTimer(db, deps) on boot (guarded), recovery tick
│   ├── app.ts                          # MOUNT: app.use("/api/deadman", requireAuth, createDeadmanRouter(db, deps));
│   │                                    #        + mount POST /api/test/deadman when DEADMAN_TEST_MODE=1
│   ├── db/
│   │   └── index.ts                    # ADD deadman_config + deadman_event DDL + indexes (in openDb)
│   ├── deadman/                        # NEW module
│   │   ├── engine.ts                   #   pure evaluate(config, now) + runDeadmanTick(db, deps, now); Deps type
│   │   ├── config-repo.ts             #   getConfig, upsertConfig, recordCheckin, setState, listDue(now), clearDeadman
│   │   ├── event-repo.ts              #   recordEvent (append-only), listEvents(userId)
│   │   └── driver.ts                  #   startDeadmanTimer(db, deps) — setInterval wrapper, DEADMAN_TICK_DISABLED guard
│   ├── routes/
│   │   └── deadman.ts                  # NEW: GET / (status), PUT /config (interval/grace/enabled), POST /checkin
│   ├── validation/
│   │   └── deadman.ts                  # NEW: Zod schema for config input (bounds), ParseResult union
│   ├── test-support/
│   │   └── deadman-fast-forward.ts     # NEW: handler for POST /api/test/deadman (env-gated)
│   └── cli/
│       └── deadman-tick.ts             # NEW: open db, build deps, runDeadmanTick once, exit (cron entrypoint)
└── tests/
    ├── unit/                           # deadman-engine, deadman-config-repo, deadman-event-repo, deadman-validation
    └── contract/                       # deadman-status, deadman-config, deadman-checkin, deadman-isolation

server/package.json                     # ADD script "deadman:tick": "tsx src/cli/deadman-tick.ts"

client/
├── src/
│   ├── App.tsx                         # ADD protected route /deadman → <DeadmanDashboardPage/>
│   ├── components/
│   │   └── DeadmanDashboard.tsx        # NEW: state badge, live countdown, "I'm alive" button, config form,
│   │                                    #      arm/disarm + first-arm confirm, recent-events list (a11y)
│   ├── pages/
│   │   └── DeadmanDashboardPage.tsx    # NEW: page shell (header + sign-out + back), renders <DeadmanDashboard/>
│   ├── api/
│   │   └── deadmanClient.ts            # NEW: getStatus, putConfig, checkin (+ listEvents) using apiFetch
│   └── styles.css                      # ADD: state-badge + countdown classes (WCAG AA)
└── tests/
    └── components/                     # DeadmanDashboard tests (RTL): states, countdown, check-in, config, events

e2e/
├── support/                            # ADD fast-forward + resetDeadman helper (POST /api/test/deadman, reset)
└── deadman.spec.ts                     # NEW: arm → check-in → status; miss-deadline (seam) → grace

server/.env.example                     # ADD DEADMAN_TICK_MS, DEADMAN_TICK_DISABLED, APP_BASE_URL, DEADMAN_TEST_MODE
README.md                               # UPDATE Architecture (engine/driver/tables/endpoints), Run (deadman:tick),
                                        #   Manual setup (new env vars), Tests (engine/e2e + DEADMAN_TICK_DISABLED)
```

**Structure Decision**: Keep the existing web-app layout (npm workspaces `client/`, `server/`,
`shared/`). The feature mirrors the established vertical slice — table → repo → validation → route on
the server; OpenAPI → generated shared types; API module → page → component on the client — and adds the
new cohesive `server/src/deadman/` module for the engine (engine + repos + driver), with the CLI under
the existing `server/src/cli/` and the test seam under the existing `server/src/test-support/`. The
engine is split into a **pure `evaluate`** and an **effecting `runDeadmanTick(db, deps, now)`** so the
state machine is exhaustively unit-tested with an injected clock and a spy notifier, and the same tick
backs both the in-process timer and the CLI. New env vars are read alongside `EMAIL_PROVIDER` in the
boot path; the in-process timer is disabled under `DEADMAN_TICK_DISABLED=1` for tests. Because this
feature **adds env vars, a new run command (`deadman:tick`), an engine/driver, two tables, and new
endpoints**, all four README sections (Architecture, Run, Manual setup, Tests) are updated in the same
commits (per CLAUDE.md README policy).

## Complexity Tracking

> No constitution violations — this section intentionally left empty. (The pure-`evaluate` /
> `runDeadmanTick(db, deps, now)` split, the injected notifier/clock `deps`, and absolute-timestamp
> deadlines are each required by explicit requirements — FR-008/FR-009 a testable engine, FR-013
> idempotency, FR-014 restart-safety — so none constitutes unjustified complexity. No job-queue library
> and no distributed lock are introduced; a single `setInterval` plus state-guarded idempotency meets
> the single-instance spec.)
