# Feature Specification: Liveness Engine, Check-in & Status Dashboard

**Feature Branch**: `008-deadman-engine-checkin`

**Created**: 2026-06-20

**Status**: Draft

**Input**: User description: "MVP + foundational core of the dead-man switch. A per-user switch
state machine (disarmed → active → grace → triggered): the user configures a check-in interval and a
grace period, arms the switch, sees a live status/countdown, and checks in ('I'm alive'). A
background liveness engine detects a missed deadline, moves the switch to grace, and emails reminders
to the user's own address; if grace also lapses, the switch transitions to triggered and records the
event (actual release to contacts is feature 010). Exposes status/config/check-in endpoints, a
dashboard page, and a test seam to fast-forward deadlines for e2e."

## Clarifications

### Session 2026-06-20

- Q: What are the allowed bounds for the check-in interval and grace period? → A: Interval 1 hour to
  365 days; grace 1 hour to 30 days. Defaults are deliberately generous (interval 7 days, grace 2
  days) to avoid premature triggering.
- Q: How many grace reminders are sent, and to whom? → A: In 008, reminders go to the **user's own
  email** (the address on their account), capped so the user is reminded but not spammed (a small
  fixed maximum across the grace window). Tokenized inbox check-in links are feature 011; contact
  delivery is feature 010.
- Q: Does arming require confirmation? → A: The **first** arm requires an explicit confirmation step
  in the UI (premature-trigger safety, roadmap §6). Subsequent config changes and re-arms do not.
- Q: What happens on grace-expiry in 008 (no contacts yet)? → A: Transition to `triggered` and record
  a `triggered` event. No email is sent to contacts in 008 (that is 010); the state machine is
  nonetheless complete and end-to-end testable.
- Q: How is time made deterministic for the engine and for e2e? → A: The engine takes an injected
  `now`; deadlines are stored as absolute timestamps so restarts never lose or invent time. An
  env-gated test seam fast-forwards a switch's deadline into the past so e2e need not wait real time.
- Q: Should the in-process timer be the only driver? → A: No. The same pure tick is exposed as an
  `npm run deadman:tick` CLI for an external cron, and the in-process timer is disabled by an env flag
  (tests, or when an external cron is used). Both paths are idempotent so they never double-act.

## User Scenarios & Testing *(mandatory)*

<!--
  User stories are prioritised, independently testable journeys. US1 alone is a viable MVP: a user can
  arm, see a live countdown, and check in. US2 adds the automatic miss-deadline → grace → reminders
  behaviour. US3 adds visibility of what happened (history). US4 lets the user pause/disarm.
-->

### User Story 1 - Configure, arm, and check in (Priority: P1)

A signed-in user opens the dead-man switch dashboard, sets a check-in interval and a grace period,
**arms** the switch (confirming the first time), then sees a live state badge and a countdown to their
next deadline. They press a prominent "I'm alive" button to check in, which resets the countdown.

**Why this priority**: This is the core mechanism and the smallest slice that delivers value — a user
can configure and operate the switch and prove they are alive. Everything else (automatic grace,
history, disarm) builds on this configured, armed, checkable switch.

**Independent Test**: Sign in, open the dashboard, set an interval + grace and arm (confirm); verify
the state shows `active` with a `next_checkin_due_at` interval ahead and a counting-down
`secondsUntilDue`; press check-in and verify the deadline moves forward by one interval and a
`checkin` event is recorded.

**Acceptance Scenarios**:

1. **Given** a signed-in user who has never configured the switch, **When** they open the dashboard,
   **Then** they see the `disarmed` state, the default interval and grace pre-filled, and no countdown.
2. **Given** a signed-in user on the dashboard, **When** they set a valid interval and grace, enable
   the switch, and confirm the first-arm prompt, **Then** the switch becomes `active`,
   `next_checkin_due_at` is set to now + interval, an `armed` event is recorded, and the dashboard
   shows a counting-down `secondsUntilDue`.
3. **Given** an `active` switch, **When** the user presses "I'm alive" (check-in), **Then**
   `last_checkin_at` is set to now, `next_checkin_due_at` is moved to now + interval, the state stays
   `active`, a `checkin` event is recorded, and the countdown resets.
4. **Given** a signed-in user, **When** they submit an interval or grace outside the allowed bounds,
   **Then** the request is rejected with a clear validation message and no configuration is changed.
5. **Given** a visitor who is not signed in, **When** they call any dead-man endpoint, **Then** the
   request is rejected with `401` and no switch data is disclosed.

---

### User Story 2 - Miss a deadline → grace → reminders → triggered (Priority: P1)

A user who has armed the switch and then goes silent past their next deadline is automatically moved
into a `grace` period and emailed reminder(s) at their own address. If the grace period also lapses
without a check-in, the switch transitions to `triggered`.

**Why this priority**: A dead-man switch that never fires is useless — this is the whole point of the
engine. It is independently testable from US1 by driving the pure tick with an injected clock (or via
the test-mode fast-forward seam) rather than waiting real minutes.

**Independent Test**: Arm a switch, fast-forward `next_checkin_due_at` into the past (test seam or
injected `now`), run one tick: assert the state is `grace`, `grace_deadline_at` is set, a reminder was
sent to the user's own email, and an `entered_grace` + `reminder_sent` event are recorded. Fast-forward
past `grace_deadline_at`, run a tick: assert the state is `triggered` and a `triggered` event exists.
Running the tick again changes nothing (idempotent).

**Acceptance Scenarios**:

1. **Given** an `active` switch whose `next_checkin_due_at` is now in the past, **When** the engine
   ticks, **Then** the switch moves to `grace`, `grace_deadline_at` is set to now + grace period, a
   reminder email is sent to the user's own address, and `entered_grace` + `reminder_sent` events are
   recorded.
2. **Given** a switch in `grace` whose `grace_deadline_at` is still in the future, **When** the engine
   ticks and another reminder is due (and the reminder cap is not reached), **Then** an additional
   reminder is sent and `reminders_sent` is incremented; if no reminder is due yet, nothing is sent.
3. **Given** a switch in `grace`, **When** the user checks in before `grace_deadline_at`, **Then** the
   switch returns to `active`, `next_checkin_due_at` is reset to now + interval, `grace_deadline_at`
   and `reminders_sent` are cleared, and a `checkin` event is recorded.
4. **Given** a switch in `grace` whose `grace_deadline_at` is now in the past, **When** the engine
   ticks, **Then** the switch moves to `triggered` and a `triggered` event is recorded (no contact
   email in 008).
5. **Given** a `triggered` switch, **When** the engine ticks again, **Then** no further state change
   or event occurs (idempotent — the engine never re-triggers).
6. **Given** the in-process timer is disabled and only the CLI runs, **When** `npm run deadman:tick`
   executes, **Then** exactly the same transitions occur as the in-process tick, then the process
   exits.

---

### User Story 3 - See recent switch activity (Priority: P2)

A user reviews a list of recent switch events (armed, checked in, entered grace, reminder sent,
triggered, config changed) so they can confirm the switch is behaving and understand its history.

**Why this priority**: Visibility builds trust in a safety-critical mechanism, but the switch is fully
functional without the history view — it is a read-only enhancement over US1/US2.

**Independent Test**: Arm, check in, and force a grace transition for a user; open the dashboard and
confirm the recent-events list shows those events in reverse-chronological order, scoped to that user,
with no note plaintext in any event detail.

**Acceptance Scenarios**:

1. **Given** a user who has armed, checked in, and entered grace, **When** they view the dashboard,
   **Then** the recent-events list shows those events newest-first with a human-readable type and
   timestamp.
2. **Given** two distinct users, **When** each views their dashboard, **Then** each sees only their
   own events and never the other's.
3. **Given** any recorded event, **When** its detail is inspected, **Then** it never contains note
   plaintext or any token value.

---

### User Story 4 - Disarm / pause the switch (Priority: P2)

A user disarms (pauses) the switch at any time so it stops counting down and cannot fire while they
are knowingly unavailable for check-ins (travel, etc.).

**Why this priority**: Disarming is essential premature-trigger protection, but the engine and
check-in (US1/US2) deliver value first. Disarm is the safety valve layered on top.

**Independent Test**: Arm a switch, then disable it via config; verify the state becomes `disarmed`,
the countdown stops, the engine never transitions a `disarmed` switch, and a `disarmed` event is
recorded. Re-enable and verify it returns to `active` with a fresh deadline.

**Acceptance Scenarios**:

1. **Given** an `active` (or `grace`) switch, **When** the user disables it, **Then** the state becomes
   `disarmed`, `next_checkin_due_at`/`grace_deadline_at` are cleared, and a `disarmed` event is recorded.
2. **Given** a `disarmed` switch, **When** the engine ticks, **Then** no transition occurs and no
   reminder or trigger is produced.
3. **Given** a `disarmed` switch, **When** the user re-enables it, **Then** it returns to `active` with
   `next_checkin_due_at` = now + interval and an `armed` event is recorded (a fresh first-arm
   confirmation is required if this is again the very first arm experience for clarity).

---

### Edge Cases

- **Not signed in**: Every dead-man endpoint requires authentication; an unauthenticated request is
  rejected with `401` and reveals no switch state.
- **Cross-user isolation**: All reads, writes, and engine actions are scoped by `user_id`; one user's
  switch is never visible to, nor affected by, another user.
- **Out-of-bounds config**: An interval or grace below the minimum or above the maximum is rejected
  with a clear message; existing config is unchanged.
- **Check-in while disarmed**: Checking in on a `disarmed` switch is rejected (or no-ops) with a clear
  message — there is no live deadline to reset; nothing is recorded as a check-in.
- **Check-in while triggered**: Once `triggered`, a check-in cannot "un-fire" the switch in 008; the
  user is told the switch has already fired (recovery/cancel is out of scope for 008).
- **Restart mid-countdown**: Because deadlines are absolute timestamps in the database, restarting the
  server neither loses elapsed time nor falsely fires; on boot the engine recovers and evaluates due
  switches.
- **Double driver**: If both the in-process timer and an external cron run, repeated ticks never
  double-send a single reminder beyond the cap nor double-trigger (state-guarded, idempotent).
- **Clock just at the deadline**: A switch is "due" when `now >= next_checkin_due_at` (inclusive
  boundary); the same inclusive rule applies to `grace_deadline_at`.
- **Config change while armed**: Changing the interval while `active` recomputes `next_checkin_due_at`
  from the last check-in (or now) so the new interval takes effect predictably; a `config_changed`
  event is recorded.
- **Reminder send failure**: If a reminder email fails to send, the tick does not crash or skip the
  rest of the batch; the failure is recorded (no sensitive content) and retried on a later tick within
  the cap.
- **Tests must not run the timer**: When `DEADMAN_TICK_DISABLED=1`, the in-process timer never starts,
  so test/e2e runs are deterministic.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST maintain, per user, a dead-man switch with exactly one state from
  {`disarmed`, `active`, `grace`, `triggered`} and a single configuration (check-in interval, grace
  period, enabled flag).
- **FR-002**: The system MUST let an authenticated user read their switch status, including the current
  state, the configured interval and grace, the absolute next-check-in deadline, and a
  `secondsUntilDue` value derived from that deadline and the current time.
- **FR-003**: The system MUST let an authenticated user set their check-in interval and grace period,
  each validated against shared minimum/maximum bounds, rejecting out-of-bounds values with a clear
  message and no change.
- **FR-004**: The system MUST let an authenticated user arm the switch (enable) — transitioning
  `disarmed → active`, setting `next_checkin_due_at` = now + interval, and recording an `armed` event.
- **FR-005**: The system MUST require an explicit confirmation in the UI before the user's **first**
  arm of the switch (premature-trigger safety).
- **FR-006**: The system MUST let an authenticated user disarm the switch (disable) — transitioning to
  `disarmed`, clearing the live deadlines, and recording a `disarmed` event.
- **FR-007**: The system MUST let an authenticated user check in ("I'm alive") on an `active` or
  `grace` switch, setting `last_checkin_at` = now, resetting `next_checkin_due_at` = now + interval,
  returning the switch to `active`, clearing grace bookkeeping, and recording a `checkin` event.
- **FR-008**: The system MUST provide a pure `evaluate(config, now)` function that, given a switch
  configuration and a timestamp, returns the transition decision (stay, enter grace + send reminder,
  send another reminder, trigger) without performing any I/O.
- **FR-009**: The system MUST provide `runDeadmanTick(db, deps, now)` that loads due switches, applies
  the decisions from `evaluate`, performs side effects only through injected `deps` (a notifier and a
  clock), persists the new state and deadlines, and records the corresponding events.
- **FR-010**: When an `active` switch's `next_checkin_due_at` is at or before `now`, the tick MUST
  transition it to `grace`, set `grace_deadline_at` = now + grace, send a reminder to the user's own
  email address via the generic `notify()` dispatcher, and record `entered_grace` + `reminder_sent`.
- **FR-011**: While a switch is in `grace` and before `grace_deadline_at`, the tick MUST send at most a
  fixed maximum number of reminders to the user's own email, incrementing a reminder counter, and MUST
  NOT exceed that cap.
- **FR-012**: When a `grace` switch's `grace_deadline_at` is at or before `now`, the tick MUST
  transition it to `triggered` and record a `triggered` event. (Contact delivery is feature 010; 008
  sends no contact email.)
- **FR-013**: The engine MUST be idempotent and state-guarded: re-running a tick (including concurrent
  in-process timer and external cron) MUST NOT double-send a reminder beyond the cap nor re-trigger a
  switch.
- **FR-014**: The system MUST store all deadlines as absolute ISO-8601 timestamps so that a process
  restart neither loses elapsed time nor falsely fires, and MUST evaluate due switches on boot
  (recovery).
- **FR-015**: The system MUST drive the engine with an in-process interval timer (default 60 000 ms,
  configurable) that is disabled when `DEADMAN_TICK_DISABLED=1`, and MUST also expose the same single
  tick as an `npm run deadman:tick` CLI for an external scheduler.
- **FR-016**: The system MUST record every switch transition and notable action as an append-only event
  (`armed`, `disarmed`, `checkin`, `entered_grace`, `reminder_sent`, `triggered`, `config_changed`),
  and MUST let the user list their own recent events newest-first.
- **FR-017**: The system MUST never include note plaintext, any token value, or any secret in an event
  detail, an API response, or a log line.
- **FR-018**: The system MUST scope every switch read, write, and engine action to the owning user via
  `user_id`, so a user can never observe or affect another user's switch.
- **FR-019**: The system MUST reject all dead-man reads and writes from unauthenticated callers with
  `401`, disclosing no switch data.
- **FR-020**: The system MUST provide an env-gated test seam (mounted only when `DEADMAN_TEST_MODE=1`)
  that fast-forwards a switch's `next_checkin_due_at`/`grace_deadline_at` into the past for the
  authenticated user, so end-to-end tests can exercise miss-deadline → grace → triggered without
  waiting real time.
- **FR-021**: The system MUST share the interval/grace bounds and defaults between client and server
  (one source of truth) so both enforce identical limits.
- **FR-022**: A reminder email send failure MUST NOT abort the tick or other users' processing; the
  failure MUST be handled without leaking sensitive content and the reminder retried on a later tick
  within the cap.

### Key Entities *(include if feature involves data)*

- **Dead-man configuration (`deadman_config`)**: One row per user (keyed by `user_id`). Holds the
  `enabled` flag, the `state`, the `checkin_interval_seconds`, the `grace_period_seconds`, the absolute
  `last_checkin_at`, `next_checkin_due_at`, and `grace_deadline_at` timestamps, the `reminders_sent`
  counter, and creation/update metadata. Indexed by `(state, next_checkin_due_at)` so the engine can
  cheaply select due switches.
- **Dead-man event (`deadman_event`)**: Append-only audit entry owned by a user. Holds an `id`, the
  `user_id`, a `type` (one of the transition/action kinds), an optional JSON `detail` that never
  contains note plaintext or tokens, and a `created_at` timestamp. Indexed by `(user_id, created_at)`.
- **User**: The existing authenticated account (from feature 002). Owns exactly one switch
  configuration and zero or more events; the reminder recipient in 008 is the user's own account email.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in user can configure, arm (with first-arm confirmation), and see a live
  countdown for their switch in under 30 seconds from opening the dashboard.
- **SC-002**: A check-in resets the countdown so that, immediately after, `secondsUntilDue` equals the
  configured interval (within one second) 100% of the time.
- **SC-003**: For a switch whose deadline has passed, exactly one `entered_grace` transition and one
  initial reminder occur per missed deadline — never zero, never duplicated — across any number of
  ticks.
- **SC-004**: For a switch whose grace has lapsed, exactly one `triggered` transition occurs; repeated
  ticks produce no additional triggers (idempotency verified by re-running the tick).
- **SC-005**: 100% of switch reads, writes, events, and engine actions are scoped to the owning user;
  no test observes another user's switch state or events.
- **SC-006**: After a simulated process restart, no armed switch loses elapsed time or fires early —
  the next deadline is identical to before the restart (absolute timestamps).
- **SC-007**: 0 reminders exceed the configured per-grace cap, and 0 reminders/triggers/events contain
  note plaintext or token values (verified by inspecting event details and captured emails).
- **SC-008**: With `DEADMAN_TICK_DISABLED=1`, the in-process timer never runs during the test suite,
  and every engine test is deterministic via the injected clock.
- **SC-009**: An end-to-end run can drive arm → miss deadline → grace using the `DEADMAN_TEST_MODE`
  seam in under 10 seconds of wall-clock time (no real-time waiting).

## Assumptions

- **Authentication exists**: The Google SSO session model (feature 002) identifies the current user and
  protects every dead-man endpoint via the existing `requireAuth` middleware; this feature adds no new
  auth.
- **Email dispatcher exists**: Reminders are sent through the generic `notify()` dispatcher + email
  channel (feature 005); 008 calls it for the user's own account email and adds no new provider.
- **Per-user privacy**: A switch is private to its owner, consistent with the note/contact ownership
  model (features 004/006). There is no sharing in 008.
- **No contact delivery yet**: In 008, grace-expiry transitions to `triggered` and records the event;
  emailing verified contacts with one-time secure links is feature 010. Contact verification is 009;
  tokenized inbox check-in links are 011.
- **Generous defaults**: Defaults (interval 7 days, grace 2 days) and a confirm-before-first-arm step
  bias strongly against premature triggering.
- **Single instance**: The app runs as a single Node process; the in-process timer suffices for
  liveness, with the CLI available for an external cron in production. No distributed locking is needed
  beyond the state-guarded idempotency.
- **Deterministic time in tests**: The engine takes an injected `now`; e2e uses the `DEADMAN_TEST_MODE`
  fast-forward seam rather than waiting real minutes.

## Dependencies

- The existing authentication/session model (feature 002) to identify the current user and gate every
  dead-man endpoint.
- The existing notification dispatcher and email channel (feature 005) to send grace reminders to the
  user's own email address.
- The existing per-user SQLite data store (better-sqlite3), extended with the `deadman_config` and
  `deadman_event` tables.
- The OpenAPI contract (`contracts/openapi.yaml`) + generated `shared/src/api.ts`, and shared bounds in
  `shared/src/constants.ts`, as the single typed contract across client and server.
