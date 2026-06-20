---

description: "Task list for Liveness Engine, Check-in & Status Dashboard"
---

# Tasks: Liveness Engine, Check-in & Status Dashboard

**Input**: Design documents from `/specs/008-deadman-engine-checkin/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/deadman-api.md, quickstart.md

**Tests**: MANDATORY (Constitution Principle I — TDD, NON-NEGOTIABLE). Each story's tests are written
before/alongside its implementation and must pass in CI before merge. **Every server/e2e test sets
`DEADMAN_TICK_DISABLED=1`** so the in-process timer never runs (FR-015, SC-008).

**Organization**: Tasks are grouped by user story. The shared backbone (contract, types, bounds, two
tables, repos, the pure engine, the driver + CLI, the router mount, the test seam) lives in
Setup/Foundational; each story then adds its endpoint behaviour, engine transition(s), client API call,
and UI increment — all independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (configure/arm/check-in), US2 (miss→grace→triggered), US3 (events), US4 (disarm)
- Exact file paths are included in every task

## Path Conventions

Web-app npm workspaces: `server/src`, `server/tests`, `client/src`, `client/tests`, `shared/src`,
`contracts/`, `e2e/` — per plan.md Structure Decision. The engine lives in `server/src/deadman/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Contract, shared bounds, and generated types in place before any code consumes them.

- [ ] T001 [P] Add the dead-man bounds/defaults to `shared/src/constants.ts` — `CHECKIN_INTERVAL_MIN_SECONDS` (3600), `CHECKIN_INTERVAL_MAX_SECONDS` (31_536_000), `GRACE_PERIOD_MIN_SECONDS` (3600), `GRACE_PERIOD_MAX_SECONDS` (2_592_000), `DEADMAN_DEFAULT_INTERVAL_SECONDS` (604_800), `DEADMAN_DEFAULT_GRACE_SECONDS` (172_800), `DEADMAN_MAX_GRACE_REMINDERS` (3) — and re-export them from `shared/src/index.ts`
- [ ] T002 Add the `/deadman`, `/deadman/config`, and `/deadman/checkin` paths and the `DeadmanStatus`, `DeadmanConfigInput`, `DeadmanEvent`, and `DeadmanEventListResponse` schemas to `contracts/openapi.yaml`, mirroring the Note/Contact style (per `contracts/deadman-api.md`); `DeadmanStatus` includes `state`, `enabled`, `checkinIntervalSeconds`, `gracePeriodSeconds`, `lastCheckinAt`, `nextCheckinDueAt`, `graceDeadlineAt`, `secondsUntilDue`, and `events`
- [ ] T003 Run `npm run gen:api` to regenerate `shared/src/api.ts` from the updated `contracts/openapi.yaml` (depends on T002)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The two tables, env vars, the pure engine + repos, the driver/CLI, the router mount, and
the env-gated test seam that ALL stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Add the `deadman_config` table DDL (PK `user_id` FK `user(id)`; `enabled`, `state` default `'disarmed'`, `checkin_interval_seconds`, `grace_period_seconds`, `last_checkin_at`, `next_checkin_due_at`, `grace_deadline_at`, `reminders_sent` default 0, `created_at`, `updated_at`) and the `deadman_event` table DDL (`id` PK, `user_id` FK, `type`, `detail`, `created_at`) plus `idx_deadman_state_due` on `(state, next_checkin_due_at)` and `idx_deadman_event_user` on `(user_id, created_at)` to `openDb()` in `server/src/db/index.ts` (per data-model.md)
- [ ] T005 Add the new optional env vars to `server/src/config/env.ts` — read `DEADMAN_TICK_MS` (default 60000), `DEADMAN_TICK_DISABLED`, `APP_BASE_URL` (default `http://localhost:5173`), and `DEADMAN_TEST_MODE` (boolean flag), alongside where `EMAIL_PROVIDER` is read — exposing a typed `DeadmanConfig` (fail-closed validation, secrets never logged)
- [ ] T006 [P] Create `server/src/deadman/config-repo.ts` — `getConfig(db, userId)`, `upsertConfig(db, userId, {checkinIntervalSeconds, gracePeriodSeconds, enabled}, now)`, `recordCheckin(db, userId, now)`, `setState(db, userId, state, fields, now)`, `listDue(db, now)` (selects `active` rows with `next_checkin_due_at <= now` and `grace` rows past their `grace_deadline_at`/reminder cadence via the `(state, next_checkin_due_at)` index), and `clearDeadman(db)` (test-reset); row→`DeadmanConfig` mapper
- [ ] T007 [P] Create `server/src/deadman/event-repo.ts` — append-only `recordEvent(db, userId, type, detail?, now?)` (assigns `randomUUID()` id; `detail` JSON never contains note plaintext or tokens, FR-017) and `listEvents(db, userId, limit)` (newest-first via the `(user_id, created_at)` index)
- [ ] T008 Create the empty `createDeadmanRouter(db, deps)` shell in `server/src/routes/deadman.ts`, mount it via `app.use("/api/deadman", requireAuth, createDeadmanRouter(db, deps))` in `server/src/app.ts`, and extend the `POST /api/test/reset` handler there to also call `clearDeadman(db)` (depends on T006)
- [ ] T009 [P] Create `server/src/test-support/deadman-fast-forward.ts` and mount `POST /api/test/deadman` in `server/src/app.ts` **only when `DEADMAN_TEST_MODE=1`** (same gating pattern as `AUTH_TEST_MODE`): for the authenticated user, shift `next_checkin_due_at`/`grace_deadline_at` into the past so e2e can force transitions (FR-020)
- [ ] T010 [P] Add a `resetDeadman(page)` and `fastForwardDeadman(page)` helper (calling `POST /api/test/reset` and `POST /api/test/deadman`) to `e2e/support/` for use by the deadman e2e spec
- [ ] T011 Add `server/.env.example` entries for `DEADMAN_TICK_MS`, `DEADMAN_TICK_DISABLED`, `APP_BASE_URL`, `DEADMAN_TEST_MODE` (names + purpose; no secret values)

**Checkpoint**: Tables exist, the `/api/deadman` router is mounted + auth-gated, repos + env + the test
seam are ready — user stories can begin.

---

## Phase 3: User Story 1 - Configure, arm, and check in (Priority: P1) 🎯 MVP

**Goal**: A signed-in user opens `/deadman`, sets interval + grace, arms (confirming the first time),
sees the `active` state + live countdown, and checks in to reset the deadline.

**Independent Test**: Sign in (test-login), open `/deadman`, set a valid interval + grace, arm (confirm),
verify `active` + `secondsUntilDue` ≈ interval; press "I'm alive" and verify the deadline moves forward
one interval and a `checkin` event is recorded.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [ ] T012 [P] [US1] Validation unit tests for `parseDeadmanConfigInput` (accepts in-bounds interval/grace + boolean `enabled`; rejects below-min, above-max, non-integer, missing) in `server/tests/unit/deadman-validation.test.ts`
- [ ] T013 [P] [US1] Engine unit tests for `evaluate(config, now)` — `disarmed` → noop; `active` with deadline in the future → stay; check-in math (now + interval) — in `server/tests/unit/deadman-engine.test.ts`
- [ ] T014 [P] [US1] Repo unit tests for `config-repo` — `upsertConfig` arms (`disarmed→active`, sets `next_checkin_due_at` = now + interval), `recordCheckin` resets the deadline and returns state to `active`, all scoped to `user_id` — in `server/tests/unit/deadman-config-repo.test.ts`
- [ ] T015 [P] [US1] Contract test for `GET /api/deadman` (never-configured → `200` `disarmed` with defaults + null deadlines; armed → `active` with `secondsUntilDue` > 0; no-cookie → `401`) in `server/tests/contract/deadman-status.test.ts`
- [ ] T016 [P] [US1] Contract test for `PUT /api/deadman/config` (valid + `enabled:true` → `200` `active` with `nextCheckinDueAt`; out-of-bounds interval/grace → `400 VALIDATION_ERROR`; no-cookie → `401`) and `POST /api/deadman/checkin` (on `active` → `200` with the deadline reset; no-cookie → `401`) in `server/tests/contract/deadman-config.test.ts` and `server/tests/contract/deadman-checkin.test.ts`
- [ ] T017 [P] [US1] Client component test: `DeadmanDashboard` renders the `disarmed` empty state with prefilled defaults, shows the `active` badge + counting-down countdown after arming, and resets the countdown on check-in, in `client/tests/components/DeadmanDashboard.checkin.test.tsx`

### Implementation for User Story 1

- [ ] T018 [P] [US1] Create `server/src/validation/deadman.ts` — Zod schema for config input (`checkinIntervalSeconds` int within `[CHECKIN_INTERVAL_MIN_SECONDS, CHECKIN_INTERVAL_MAX_SECONDS]`, `gracePeriodSeconds` within grace bounds, `enabled` boolean) returning the `ParseResult` discriminated union (mirroring `validation/contact.ts`)
- [ ] T019 [P] [US1] Create `server/src/deadman/engine.ts` with the pure `evaluate(config, now)` (decision union: `stay` / `enter_grace` / `remind` / `trigger` / `noop`) and the `Deps` type (`{ notify: (...) => Promise<void>; now: () => Date }`); only the `disarmed`/`active`-stay/check-in math paths are needed for US1 (grace/trigger added in US2)
- [ ] T020 [US1] Add `getConfig`, `upsertConfig` (arm/disarm + recompute deadline), and `recordCheckin` to `server/src/deadman/config-repo.ts` and a `toStatus(config, now)` helper computing `secondsUntilDue` (depends on T006)
- [ ] T021 [US1] Implement `GET /` (status), `PUT /config` (validate → `upsertConfig` → record `armed`/`disarmed`/`config_changed` event), and `POST /checkin` (`recordCheckin` on `active`/`grace`; reject when `disarmed`/`triggered`; record `checkin` event) handlers in `server/src/routes/deadman.ts` (depends on T018, T019, T020, T007)
- [ ] T022 [P] [US1] Create `client/src/api/deadmanClient.ts` — `getStatus()`, `putConfig({checkinIntervalSeconds, gracePeriodSeconds, enabled})`, `checkin()` (using `apiFetch`, surfacing server `message` on non-OK, throwing `ApiError`)
- [ ] T023 [US1] Create `client/src/components/DeadmanDashboard.tsx` — load status on mount (`loading | idle | error` union), a labelled **state badge**, a live **countdown** from `secondsUntilDue` (`role="status"` `aria-live="polite"`, `setInterval` tick), a `<label htmlFor>`-bound interval + grace config form (min/max), an **arm/disarm** control with a **confirm dialog before the first arm**, and a big "I'm alive" **check-in** `<button>`; refresh status after each action (depends on T022)
- [ ] T024 [US1] Create `client/src/pages/DeadmanDashboardPage.tsx` (header with user email + sign-out + back-to-note link, rendering `<DeadmanDashboard/>`), register a protected `/deadman` route in `client/src/App.tsx`, and add a "Switch"/"Dead-man" nav link to the note page header (depends on T023)

**Checkpoint**: `/deadman` lets the user configure, arm (with first-arm confirm), see the live
countdown, and check in — US1 independently testable.

---

## Phase 4: User Story 2 - Miss a deadline → grace → reminders → triggered (Priority: P1)

**Goal**: The engine detects a missed deadline, moves the switch to `grace`, emails reminder(s) to the
user's own address, and on grace-expiry transitions to `triggered` — all idempotently.

**Independent Test**: Arm a switch; with an injected `now` past `next_checkin_due_at`, run one tick →
state `grace`, `grace_deadline_at` set, one reminder sent to the user's own email, `entered_grace` +
`reminder_sent` events. Advance past `grace_deadline_at`, tick → `triggered` + `triggered` event.
Re-tick → no change (idempotent).

### Tests for User Story 2 ⚠️ (write first, ensure they FAIL)

- [ ] T025 [P] [US2] Engine unit tests for `evaluate` — `active` past deadline → `enter_grace`; `grace` before `grace_deadline_at` with a reminder due → `remind` (and not due → `stay`); `grace` at/past `grace_deadline_at` → `trigger`; `triggered` → `noop`; reminder cap (`DEADMAN_MAX_GRACE_REMINDERS`) honoured — appended to `server/tests/unit/deadman-engine.test.ts`
- [ ] T026 [P] [US2] `runDeadmanTick(db, deps, now)` unit tests with an **injected clock + spy notifier**: a due `active` switch → `grace` + exactly one reminder to the user's own email + `entered_grace`/`reminder_sent` events; a lapsed `grace` switch → `triggered` + `triggered` event (no contact email in 008); **re-running the tick is a no-op** (no duplicate reminder beyond the cap, no re-trigger) — `boot recovery` evaluates due switches — in `server/tests/unit/deadman-tick.test.ts`
- [ ] T027 [P] [US2] Repo unit test for `config-repo.listDue(now)` and `setState` — selects only due `active`/`grace` rows, scoped correctly; appended to `server/tests/unit/deadman-config-repo.test.ts`
- [ ] T028 [P] [US2] Contract test: after the test seam fast-forwards a deadline into the past and a tick runs (invoked in-test), `GET /api/deadman` reports `grace` then `triggered`; a check-in during `grace` returns to `active` (`POST /api/deadman/checkin`) — in `server/tests/contract/deadman-checkin.test.ts` (extends T016)

### Implementation for User Story 2

- [ ] T029 [US2] Extend `evaluate(config, now)` in `server/src/deadman/engine.ts` with the `enter_grace`, `remind` (cap-aware), and `trigger` decisions (inclusive boundary: `now >= deadline`) (depends on T019)
- [ ] T030 [US2] Add `setState` and `listDue(now)` to `server/src/deadman/config-repo.ts` (set `grace_deadline_at`/`reminders_sent`; clear them on return-to-active) (depends on T020)
- [ ] T031 [US2] Implement `runDeadmanTick(db, deps, now)` in `server/src/deadman/engine.ts` — `listDue` → for each, `evaluate` → on `enter_grace`: `setState('grace')` + `notify()` reminder to the user's own account email (via `deps.notify`, generic dispatcher) + record `entered_grace`/`reminder_sent`; on `remind`: send + increment `reminders_sent` + record `reminder_sent`; on `trigger`: `setState('triggered')` + record `triggered`; state-guarded + idempotent; a per-user send failure is caught and recorded without aborting the batch (FR-022) (depends on T029, T030, T007)
- [ ] T032 [US2] Create `server/src/deadman/driver.ts` — `startDeadmanTimer(db, deps)` returning a `setInterval(() => runDeadmanTick(db, deps, new Date()), DEADMAN_TICK_MS)` wrapper that **does nothing when `DEADMAN_TICK_DISABLED=1`**, and a one-shot boot-recovery tick (depends on T031)
- [ ] T033 [US2] Wire `server/src/server.ts` boot: build `deps` (a notifier closure over `buildRegistry(emailProvider)` + `notify()`, and a `Date` clock), run a recovery tick, and call `startDeadmanTimer(db, deps)` (no-op under `DEADMAN_TICK_DISABLED=1`) (depends on T032)
- [ ] T034 [US2] Create `server/src/cli/deadman-tick.ts` (open db, build the same `deps`, run `runDeadmanTick` once, then exit) and add `"deadman:tick": "tsx src/cli/deadman-tick.ts"` to `server/package.json` scripts (depends on T031)

**Checkpoint**: The engine automatically detects misses, enters grace with capped user reminders, and
triggers on grace-expiry — idempotently. US1 + US2 both work independently.

---

## Phase 5: User Story 3 - See recent switch activity (Priority: P2)

**Goal**: The dashboard shows the user's recent switch events, newest-first, scoped to them, with no
sensitive content.

**Independent Test**: Arm, check in, and force a grace transition; open `/deadman` and confirm the
recent-events list shows those events newest-first; a second user sees only their own.

### Tests for User Story 3 ⚠️ (write first, ensure they FAIL)

- [ ] T035 [P] [US3] Repo unit test for `event-repo.listEvents` — returns only the given user's events newest-first; `recordEvent` detail never contains note plaintext/tokens — appended to `server/tests/unit/deadman-event-repo.test.ts`
- [ ] T036 [P] [US3] Contract test: `GET /api/deadman` includes an `events` array reflecting `armed`/`checkin`/`entered_grace` after those actions, newest-first; in `server/tests/contract/deadman-status.test.ts` (extends T015)
- [ ] T037 [P] [US3] Client component test: `DeadmanDashboard` renders a semantic `<ul>/<li>` recent-events list with human-readable type + timestamp, in `client/tests/components/DeadmanDashboard.events.test.tsx`

### Implementation for User Story 3

- [ ] T038 [US3] Ensure `GET /` includes `events: listEvents(db, userId, limit)` in the `DeadmanStatus` response in `server/src/routes/deadman.ts` (depends on T021, T007)
- [ ] T039 [US3] Add the recent-events list section to `client/src/components/DeadmanDashboard.tsx` — a semantic `<ul>/<li>` of events (type label + relative/absolute time), empty-state when none (depends on T023, T038)

**Checkpoint**: Users can review their switch history; US1–US3 independently functional.

---

## Phase 6: User Story 4 - Disarm / pause the switch (Priority: P2)

**Goal**: The user disarms the switch at any time; the engine never acts on a `disarmed` switch; re-arm
returns it to `active` with a fresh deadline.

**Independent Test**: Arm, then disable via config → `disarmed`, deadlines cleared, countdown stops, a
`disarmed` event recorded; tick → no transition. Re-enable → `active` with a fresh deadline.

### Tests for User Story 4 ⚠️ (write first, ensure they FAIL)

- [ ] T040 [P] [US4] Engine/tick unit test: a `disarmed` switch is never selected by `listDue` and `evaluate` returns `noop`, so a tick leaves it unchanged — appended to `server/tests/unit/deadman-tick.test.ts`
- [ ] T041 [P] [US4] Contract test: `PUT /api/deadman/config` with `enabled:false` → `200` `disarmed` with null deadlines + a `disarmed` event; re-enable → `active` with a fresh `nextCheckinDueAt` — appended to `server/tests/contract/deadman-config.test.ts`
- [ ] T042 [P] [US4] Client component test: `DeadmanDashboard` disarm flow stops the countdown and shows the `disarmed` badge; first-arm confirm is required again on a fresh arm — in `client/tests/components/DeadmanDashboard.disarm.test.tsx`

### Implementation for User Story 4

- [ ] T043 [US4] Ensure `upsertConfig`/`PUT /config` handles `enabled:false` (→ `disarmed`, clear `next_checkin_due_at`/`grace_deadline_at`/`reminders_sent`, record `disarmed`) and that `listDue` excludes `disarmed` rows in `server/src/deadman/config-repo.ts` + `server/src/routes/deadman.ts` (depends on T020, T021, T030)
- [ ] T044 [US4] Add the disarm control + state handling to `client/src/components/DeadmanDashboard.tsx` (stop the countdown interval when not `active`/`grace`; surface the `disarmed`/`triggered` badges) (depends on T023)

**Checkpoint**: All four stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Cross-story isolation, end-to-end coverage, styling, docs, and quality gates.

- [ ] T045 [P] Cross-cutting contract test: two test-login users (distinct `sub`) — user B's `GET /api/deadman` never reflects A's state/events, and B's config/check-in never affects A's switch (FR-018) — in `server/tests/contract/deadman-isolation.test.ts`
- [ ] T046 [P] Add the state-badge + countdown CSS classes (WCAG AA contrast, focus states) to `client/src/styles.css`
- [ ] T047 Create `e2e/deadman.spec.ts` (Playwright): arm (confirm) → see countdown → check-in → status stays `active`; then fast-forward via `POST /api/test/deadman` and confirm the dashboard reflects `grace` — using `loginAs`/`resetDeadman`/`fastForwardDeadman`
- [ ] T048 Update `README.md`: **Architecture** (the `deadman/` engine + driver, the two tables, the `/api/deadman` endpoints, reminders via `notify()`), **Run** (the `npm run deadman:tick` command + in-process timer), **Manual setup** (`DEADMAN_TICK_MS`, `DEADMAN_TICK_DISABLED`, `APP_BASE_URL`, `DEADMAN_TEST_MODE` — names + purpose, no secrets), and **Tests** (engine/e2e commands + the `DEADMAN_TICK_DISABLED=1` requirement) — in the same commits as the code slices (per CLAUDE.md README policy)
- [ ] T049 [P] Run the full gates and quickstart validation: `npm run typecheck`, `npm test`, `npm run test:e2e`, and the manual steps in `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 [P] is independent; T002 → T003 (gen:api needs the updated contract).
- **Foundational (Phase 2)**: Depends on Setup (generated types + bounds). BLOCKS all stories. T004 (tables) and T005 (env) precede the repos; T006/T007/T009/T010/T011 are [P] (different files); T008 waits on T006.
- **User Stories (Phase 3–6)**: All depend on Foundational. Implemented in priority order (US1 → US2 → US3 → US4). They grow the same shared files (`engine.ts`, `config-repo.ts`, `routes/deadman.ts`, `deadmanClient.ts`, `DeadmanDashboard.tsx`), so cross-story edits to those files are **sequential by design**, not parallel.
- **Polish (Phase 7)**: T045 after US1–US4 endpoints; T046/T047 after the UI + engine; T048/T049 last.

### Within Each User Story

- Tests (the `### Tests` block) are written first and must FAIL before implementation.
- Pure `evaluate` before `runDeadmanTick`; repo functions before the route handlers that call them; route before client API; client API before the UI increment.
- US1 must precede US2/US3/US4 only because they extend the same shared files; each story remains independently testable at its checkpoint.

### Parallel Opportunities

- T001 runs alongside T002.
- Foundational: T006, T007, T009, T010, T011 are [P] (different files); T008 waits on T006.
- Each story's `### Tests` tasks ([P]) run together (distinct files), as can the validation/engine/client-API creation tasks marked [P].
- T045, T046, and T049 are [P] relative to each other.

---

## Parallel Example: User Story 1

```bash
# Write US1 tests together first (distinct files):
Task: "Validation unit tests in server/tests/unit/deadman-validation.test.ts"            # T012
Task: "Engine unit tests in server/tests/unit/deadman-engine.test.ts"                    # T013
Task: "Config-repo unit tests in server/tests/unit/deadman-config-repo.test.ts"          # T014
Task: "Status contract test in server/tests/contract/deadman-status.test.ts"             # T015
Task: "Component test in client/tests/components/DeadmanDashboard.checkin.test.tsx"       # T017

# Then implement (validation/engine/client-API in parallel; route waits on them):
Task: "Create server/src/validation/deadman.ts"                                          # T018
Task: "Create server/src/deadman/engine.ts (pure evaluate)"                              # T019
Task: "Create client/src/api/deadmanClient.ts"                                           # T022
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & VALIDATE**: `/deadman` lets the
   user configure, arm (with confirm), see the live countdown, and check in. Deploy/demo.

### Incremental Delivery (matches plan.md PR slices)

1. Setup + Foundational + US1 → MVP (configure/arm/check-in).
2. US2 (miss → grace → reminders → triggered; driver + CLI) → engine tests green → demo via the seam.
3. US3 (recent events) → test → demo.
4. US4 (disarm/pause) → test → demo.
5. Polish (isolation test, styles, e2e, README, gates).

Each story adds value without breaking the previous; commit after each task or logical group as its own
bisectable `feat:` commit.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- Shared files (`engine.ts`, `config-repo.ts`, `routes/deadman.ts`, `deadmanClient.ts`, `DeadmanDashboard.tsx`) are intentionally grown across stories in priority order — that's why those impl tasks are NOT marked [P] across phases.
- **Every server/e2e test sets `DEADMAN_TICK_DISABLED=1`** so the in-process timer never runs (FR-015, SC-008); the engine is driven explicitly via `runDeadmanTick` with an injected clock.
- Reminders are sent only through the generic `notify()` dispatcher to the **user's own account email** in 008; contact delivery is feature 010 — no contact email here.
- No note plaintext / token / secret appears in any event detail, response, or log (FR-017).
- New env vars (`DEADMAN_TICK_MS`, `DEADMAN_TICK_DISABLED`, `APP_BASE_URL`, `DEADMAN_TEST_MODE`) and the new `deadman:tick` run command mean all four README sections are updated (T048).
- Verify each story's tests fail before implementing it.
