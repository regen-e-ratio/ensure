# Feature Specification: Onboarding Tutorial & Guided Setup

**Feature Branch**: `012-onboarding-tutorial`

**Created**: 2026-06-20

**Status**: Draft

**Input**: User description: "Teach the dead-man model and de-risk first use; final polish + docs for the
whole suite (008–012). First-run detection (no `deadman_config` / never armed) surfaces a dismissible,
fully accessible guided wizard that explains the flow and walks the user through: write a note → add &
verify a contact → set interval/grace → arm the switch. Integrate feature 010's 'send myself a test
release' CTA so users can preview exactly what their contacts will receive. Add an in-app help/explainer
of the dead-man model. Polish empty states and the feature-008 countdown formatting. Full accessibility
pass (keyboard nav, semantic HTML, labelled controls, WCAG AA contrast) across ALL new dead-man UI
(008–012) per constitution IV. Update all four README sections (Architecture, Run, Manual setup incl. the
new env vars + `deadman:tick`, Tests) to reflect the whole dead-man suite, and update
`server/.env.example`. This feature adds NO new backend endpoint, table, env var, or external service — it
is a client-only onboarding/help/polish layer plus documentation over the data and endpoints features
008–011 already provide."

## Clarifications

### Session 2026-06-20

- Q: What counts as a "first-run" user who should see the onboarding wizard? → A: A signed-in user whose
  dead-man switch has **never been armed** — concretely, `GET /api/deadman` reports `state: "disarmed"` and
  the switch has never reached `active` (no prior arm; equivalently no `armed` event and `last_checkin_at`
  is null). Such a user has either no usable `deadman_config` yet or a default one they have not engaged.
  Once the switch has been armed at least once, the user is no longer "first-run" and the wizard is not
  auto-shown (it remains reachable on demand from a help affordance).
- Q: Is the wizard blocking or dismissible? → A: **Dismissible and non-blocking.** It is a guide layered
  over the existing dashboard, not a gate. The user can dismiss it at any step (Escape, a labelled
  Dismiss/Skip control, or completing the flow), and the dismissal persists for the session so it does not
  re-appear on every navigation. It never prevents the user from using the dashboard directly, and it never
  performs a destructive or irreversible action on the user's behalf.
- Q: Does the wizard introduce any new backend state or endpoint? → A: **No.** First-run detection,
  step progress, and dismissal are derived entirely from existing reads (`GET /api/deadman` status,
  `GET /api/note`, `GET /api/contact`) and client-local UI state (e.g. `sessionStorage`). Each wizard step
  drives an **existing** endpoint: write a note (feature 001 `PUT /api/note`), add a contact (feature 006
  `POST /api/contact`) and verify it (feature 009 `POST /api/contact/{id}/verify`), set interval/grace and
  arm (feature 008 `PUT /api/deadman/config`), and preview a release (feature 010
  `POST /api/deadman/test-release`). No `deadman_config` column, no new table, no new env var.
- Q: What does the "send myself a test release" CTA do here? → A: It reuses feature 010's existing
  authed `POST /api/deadman/test-release`, which mints a one-time grant to the **owner's own verified**
  address so the user receives exactly the email their contacts would receive and can open the view-once
  link themselves. The wizard surfaces this as a clearly-labelled, optional CTA so a first-time user can
  build trust by previewing the recipient experience **before** arming — it does not change the endpoint's
  behaviour, it only makes it discoverable in the guided flow (and from the in-app help).
- Q: What is the in-app help/explainer? → A: An always-available, accessible explanation of the dead-man
  model (the `disarmed → active → grace → triggered` state machine, the two check-in paths, the
  verified-contacts-only one-time release, instant disarm/pause, and the safety guarantees against a
  premature trigger). It is reachable from the dashboard regardless of first-run state (e.g. a "How this
  works" affordance) and re-opens the wizard/explainer on demand. It carries **no** secret, token, or note
  plaintext — it is purely explanatory content.
- Q: What "polish" is in scope, and does it change behaviour? → A: Presentation-only polish: accessible,
  informative **empty states** across the dead-man UI (e.g. no contacts yet, no events yet, switch never
  armed) that guide the next action, and a refinement of feature 008's **countdown formatting** for
  legibility (clear units, screen-reader-friendly text, no colour-only signalling). Polish MUST NOT change
  the switch's timing semantics, the absolute-deadline clock, or any endpoint contract — it only improves
  how existing state is presented.
- Q: What is the accessibility scope? → A: A full pass over **all** dead-man UI introduced by features
  008–012 (the dashboard, config form, check-in control, events list, the public `/contact-verified`,
  `/r/:token`, and `/checked-in` pages, and the new wizard/help), bringing every one to the constitution
  IV baseline: keyboard-navigable, semantic HTML, every input with a `<label htmlFor>`, status via
  `role="status" aria-live="polite"`, errors via `role="alert"`, visible focus, and WCAG AA contrast with
  no colour-only signalling. This is corrective/verifying work over existing components, not a redesign.
- Q: What documentation changes ship with this feature? → A: All four README sections are updated to
  reflect the **whole** dead-man suite: **Architecture** (the `deadman/` module, the engine + driver + CLI,
  the new tables, the public token routes, the secure one-time release, the onboarding/help layer);
  **Run** (the exact ordered commands incl. `npm run gen:api` and the `npm run deadman:tick` CLI and how the
  in-process timer relates to it); **Manual setup** (the new optional env vars `DEADMAN_TICK_MS`,
  `DEADMAN_TICK_DISABLED`, `APP_BASE_URL`, `DEADMAN_TEST_MODE` by name + purpose + where they go, plus
  `server/.env.example` kept in sync); and **Tests** (the new server/client/e2e test categories and the
  `DEADMAN_TICK_DISABLED=1` requirement). No real secret values are written — only how to obtain/supply
  them (per CLAUDE.md README policy).

## User Scenarios & Testing *(mandatory)*

<!--
  User stories are prioritised, independently testable journeys. US1 is the core guided first-run wizard
  that walks a never-armed user through note → verified contact → interval/grace → arm. US2 is the
  integrated "preview what my contacts receive" test-release CTA. US3 is the always-available in-app
  help/explainer of the dead-man model. US4 is the accessibility pass + empty-state/countdown polish across
  the whole 008–012 dead-man UI. US5 is the whole-suite documentation (all four README sections +
  .env.example). Each is independently demoable.
-->

### User Story 1 - Guided first-run setup (Priority: P1)

A signed-in user whose switch has **never been armed** lands on the dashboard and is offered a dismissible,
accessible guided wizard. The wizard explains the dead-man model in plain language and walks them, step by
step, through the four things needed for a working switch: **write a note → add & verify a contact → set
the check-in interval and grace period → arm the switch**. At each step the wizard reflects whether that
prerequisite is already satisfied (note exists, a verified contact exists, the switch is armed) so a
returning-but-never-armed user resumes where they left off. Completing the final step arms the switch; the
wizard then steps aside.

**Why this priority**: This is the feature's whole point — it teaches the mental model and de-risks first
use, directly attacking the roadmap's worst failure mode (a premature or never-completed setup) by guiding
the user through the exact sequence the dead-man guarantee requires. A user who finishes the wizard has a
correctly-configured, armed switch with a verified recipient.

**Independent Test**: As a freshly-signed-in user whose `GET /api/deadman` reports `disarmed` with no prior
arm, load the dashboard and assert the wizard is offered; step through it (each step driving the existing
note/contact/verify/config endpoints) and assert that reaching the end leaves the switch `active` with a
verified contact and a note present; assert that dismissing the wizard at any step leaves the dashboard
fully usable and the wizard hidden for the session.

**Acceptance Scenarios**:

1. **Given** a signed-in user whose switch has never been armed (status `disarmed`, no `armed` event,
   `last_checkin_at` null), **When** the dashboard loads, **Then** the guided wizard is offered with a clear
   first step and an explanation of the dead-man model, and a labelled control to dismiss/skip it.
2. **Given** the wizard's "write a note" step, **When** the user saves a note, **Then** the step is marked
   complete (reflecting the existing note) and the wizard advances to the "add & verify a contact" step.
3. **Given** the "add & verify a contact" step, **When** the user adds a contact and verifies it (driving
   the existing add + verify endpoints), **Then** the step is marked complete once at least one contact is
   verified and the wizard advances to the "set interval & grace" step.
4. **Given** the "set interval & grace" step, **When** the user chooses an interval and grace period within
   the shared bounds and confirms arming, **Then** the existing config/arm endpoint is called, the switch
   becomes `active`, and the wizard advances to a completion state.
5. **Given** a user who has already armed the switch at least once (status ever `active`, or an `armed`
   event exists), **When** the dashboard loads, **Then** the wizard is **not** auto-shown (but remains
   reachable on demand from the help affordance).
6. **Given** the wizard at any step, **When** the user presses Escape or activates the Dismiss/Skip control,
   **Then** the wizard hides, the dashboard remains fully usable, and the wizard does not re-appear on
   subsequent navigation within the session.
7. **Given** a returning user who completed only some steps earlier in the session (e.g. a note exists but
   no verified contact), **When** the dashboard loads, **Then** the wizard resumes at the first incomplete
   step rather than restarting.

---

### User Story 2 - Preview what my contacts will receive (Priority: P1)

Before trusting the switch, a first-time user can **send themselves a test release**: the wizard (and the
in-app help) surface feature 010's existing "send myself a test release" CTA, which mints a one-time grant
to the user's **own verified** address. The user receives exactly the email their contacts would receive
and opens the view-once link to see precisely what will be revealed — building trust without "dying".

**Why this priority**: Trust is the adoption blocker for a dead-man switch. Letting a user safely preview
the recipient experience — the actual email and the view-once page — before arming is the single most
reassuring step, and it reuses an endpoint that already exists (no new backend).

**Independent Test**: As a user with a verified own-address contact, activate the wizard's/help's
"send myself a test release" CTA and assert it calls the existing `POST /api/deadman/test-release`,
surfaces the resulting grant count / outcome accessibly, and clearly explains that the user will receive
the email a contact would and that the link is view-once; assert the CTA is disabled or clearly guarded
when no verified contact exists, with an explanation of the prerequisite.

**Acceptance Scenarios**:

1. **Given** a user with at least one verified contact, **When** they activate "send myself a test
   release", **Then** the existing `POST /api/deadman/test-release` is called and the UI confirms (via an
   accessible live region) that a preview release was sent to their own verified address, explaining the
   email mirrors what a contact receives and the link can be viewed once.
2. **Given** a user with **no** verified contact, **When** they view the test-release CTA, **Then** it is
   disabled or clearly guarded with a message explaining that a verified contact is required first
   (pointing back to the verify step), and it does not call the endpoint.
3. **Given** a test release was just previewed, **When** the user reads the confirmation, **Then** it
   discloses **no** token and no note plaintext in the UI — only that the preview email was sent (the
   secret lives only in the emailed one-time link, per feature 010).
4. **Given** the test-release request fails, **When** the error is surfaced, **Then** it appears via
   `role="alert"` with a generic message and the UI does not falsely claim a preview was sent.

---

### User Story 3 - In-app help / explainer of the dead-man model (Priority: P2)

From the dashboard — whether or not they are first-run — a user can open an accessible "How this works"
explainer that describes the dead-man model: the `disarmed → active → grace → triggered` state machine, the
two check-in paths (dashboard button and email link), the verified-contacts-only one-time secure release,
instant disarm/pause, and the safeguards against a premature trigger. The same affordance re-opens the
guided wizard on demand.

**Why this priority**: The wizard teaches at first run, but users need a durable reference afterwards.
A persistent, accessible explainer reduces confusion and support load and lets a returning user re-launch
the guided flow without hunting. It ranks below the core setup/preview because it informs rather than
configures.

**Independent Test**: Open the help/explainer from the dashboard and assert it renders the dead-man model
(states, check-in paths, release model, disarm, safeguards) as semantic, keyboard-navigable content with no
secret/token/plaintext; assert it offers a control to (re-)launch the guided wizard; assert it is reachable
both for first-run and already-armed users.

**Acceptance Scenarios**:

1. **Given** any signed-in user on the dashboard, **When** they open "How this works", **Then** an
   accessible explainer of the dead-man model (states, both check-in paths, the one-time verified-contact
   release, disarm/pause, anti-premature-trigger safeguards) is shown with semantic headings and keyboard
   navigation.
2. **Given** the explainer is open, **When** the user activates "Show me / restart the guide", **Then** the
   guided wizard (US1) opens at its first step (or first incomplete step).
3. **Given** an already-armed user, **When** they open the explainer, **Then** it is fully available (the
   explainer is not gated on first-run state) and contains no secret, token, or note plaintext.
4. **Given** the explainer, **When** it is rendered, **Then** it is dismissible by keyboard (Escape) and via
   a labelled control, traps/returns focus appropriately, and uses no colour-only signalling.

---

### User Story 4 - Accessibility pass + empty-state & countdown polish (Priority: P2)

Every piece of dead-man UI introduced across features 008–012 — the dashboard, config form, check-in
control, events list, the public `/contact-verified`, `/r/:token`, and `/checked-in` pages, and the new
wizard/help — meets the constitution IV accessibility baseline. Empty states across the dead-man UI are
informative and guide the next action, and feature 008's countdown is formatted for legibility and screen
readers without colour-only signalling.

**Why this priority**: Accessibility is a correctness property (constitution IV) and the polish removes
first-use friction (clear empty states, a legible countdown). It is the suite-wide quality gate but ranks
below the functional setup/preview/help because it refines rather than adds capability.

**Independent Test**: Run component/e2e accessibility assertions over each dead-man surface (keyboard
reachability, semantic landmarks/headings, every input labelled, `role="status"`/`role="alert"` regions, no
colour-only signalling); assert the empty states (no contacts, no events, switch never armed) render
informative guidance; assert the refined countdown announces remaining time legibly (clear units,
screen-reader text) and that timing semantics are unchanged.

**Acceptance Scenarios**:

1. **Given** each dead-man surface (008–012), **When** navigated by keyboard only, **Then** every
   interactive control is reachable and operable, has a visible focus state, and exposes an accessible name
   (a `<label htmlFor>` for every input).
2. **Given** any status or error in the dead-man UI, **When** it appears, **Then** status uses
   `role="status" aria-live="polite"` and errors use `role="alert"`, and no state is conveyed by colour
   alone (WCAG AA contrast).
3. **Given** an empty dead-man surface (no contacts yet, no events yet, switch never armed), **When** it
   renders, **Then** it shows an informative empty state that names the next action rather than a blank or
   cryptic placeholder.
4. **Given** an armed switch with a live countdown, **When** the countdown renders, **Then** it shows clear
   units and screen-reader-friendly text, conveys urgency without colour alone, and the underlying timing
   (absolute deadline) is unchanged by the formatting.

---

### User Story 5 - Whole-suite documentation (Priority: P2)

All four README sections, plus `server/.env.example`, are updated to reflect the entire dead-man suite
(008–012): how it is architected, how to run it (including codegen and the `deadman:tick` CLI), every new
manual-setup env var (by name + purpose + where it goes, never a real secret), and how to test it.

**Why this priority**: The README is the single source of operational truth (CLAUDE.md). After five
features add a scheduler, public token routes, new tables, and new env vars, the docs must match reality or
the suite is operationally undeliverable. It ranks alongside the other polish because it is the project's
definition-of-done for the whole roadmap.

**Independent Test**: Inspect `README.md` and assert all four sections describe the dead-man suite
accurately — **Architecture** (the `deadman/` engine/driver/CLI, the new tables, the public token routes,
the secure one-time release, the onboarding/help layer); **Run** (the ordered commands incl. `gen:api` and
`deadman:tick`); **Manual setup** (the new optional env vars by name/purpose/location, no real secrets);
**Tests** (the new test categories + `DEADMAN_TICK_DISABLED=1`); assert `server/.env.example` lists the new
vars consistently; assert no secret values are present.

**Acceptance Scenarios**:

1. **Given** the README **Architecture** section, **When** read, **Then** it describes the dead-man engine
   (`runDeadmanTick`/`evaluate`), the in-process driver + `npm run deadman:tick` CLI, the new tables
   (`deadman_config`, `deadman_event`, `release`, `release_grant`, `checkin_token`, contact verification
   columns), the public token routes (release view, contact verify, email check-in), the secure one-time
   release model, and the onboarding/help client layer.
2. **Given** the README **Run** section, **When** followed, **Then** the exact ordered commands start the
   app (including `npm run gen:api` and how the in-process tick relates to `npm run deadman:tick`) with the
   resulting URLs/ports.
3. **Given** the README **Manual setup** section and `server/.env.example`, **When** compared, **Then** both
   list `DEADMAN_TICK_MS`, `DEADMAN_TICK_DISABLED`, `APP_BASE_URL`, and `DEADMAN_TEST_MODE` (and any other
   suite env) by name + purpose + where they go, consistently, with **no** real secret values.
4. **Given** the README **Tests** section, **When** read, **Then** it lists the server (vitest/supertest),
   client (vitest/RTL), and e2e (Playwright) commands and variants, the `DEADMAN_TICK_DISABLED=1`
   requirement so the timer never runs in tests, and the merge quality gates.

---

### Edge Cases

- **Never-armed detection**: "First-run" is derived from existing reads (status `disarmed` + no prior arm /
  `last_checkin_at` null / no `armed` event), never from a new flag; a user with a default-but-unengaged
  config is still first-run.
- **Resume mid-flow**: A returning never-armed user resumes at the first incomplete step (note exists but no
  verified contact → resume at the contact step), not from the beginning.
- **Already armed**: Once the switch has ever been armed, the wizard is not auto-shown; it remains reachable
  from the help affordance.
- **Dismiss persistence**: Dismissing hides the wizard for the session (client-local, e.g.
  `sessionStorage`); it does not write backend state and does not re-prompt on every navigation.
- **Test-release prerequisite**: The "send myself a test release" CTA requires a verified contact; with none
  it is disabled/guarded with an explanation and never calls the endpoint.
- **No secret in onboarding/help**: The wizard, help, and test-release confirmation never display a token,
  grant, or note plaintext — the only secret (the release link) lives in the emailed one-time link
  (feature 010).
- **Non-blocking**: The wizard never blocks direct dashboard use and never performs an irreversible action
  without an explicit confirm (arming is the final, confirmed step).
- **Polish is presentation-only**: Empty-state and countdown changes never alter timing semantics, the
  absolute-deadline clock, or any endpoint contract.
- **Accessibility regressions**: The pass covers public pages too (`/contact-verified`, `/r/:token`,
  `/checked-in`) so a token-only page is keyboard-reachable and announced without a session.
- **Docs/secrets**: The README and `.env.example` describe env vars by name/purpose/location only — never a
  real secret value (CLAUDE.md README policy).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The client MUST detect a **first-run** (never-armed) user from existing reads only —
  `GET /api/deadman` reporting `state: "disarmed"` with no prior arm (no `armed` event / `last_checkin_at`
  null) — and MUST NOT introduce any new backend flag, column, table, or endpoint for this.
- **FR-002**: On first run, the dashboard MUST offer a **dismissible, non-blocking** guided wizard that
  explains the dead-man model and walks the user through, in order: **write a note** (feature 001
  `PUT /api/note`), **add & verify a contact** (feature 006 `POST /api/contact` + feature 009
  `POST /api/contact/{id}/verify`), **set the check-in interval & grace period and arm** (feature 008
  `PUT /api/deadman/config`) — each step driving the **existing** endpoint, with no new endpoint added.
- **FR-003**: Each wizard step MUST reflect whether its prerequisite is already satisfied (a note exists, a
  verified contact exists, the switch is armed) from existing reads (`GET /api/note`, `GET /api/contact`,
  `GET /api/deadman`), and the wizard MUST resume at the first **incomplete** step for a returning
  never-armed user rather than restarting.
- **FR-004**: Completing the final wizard step MUST arm the switch via the existing config/arm endpoint
  (with an explicit confirm before the first arm, per roadmap §6), after which the wizard MUST step aside;
  once the switch has ever been armed the wizard MUST NOT be auto-shown (it MUST remain reachable on demand
  from the help affordance).
- **FR-005**: The wizard MUST be dismissible at any step (Escape and a labelled Dismiss/Skip control), and
  the dismissal MUST persist for the session (client-local state, e.g. `sessionStorage`) so it does not
  re-appear on every navigation; dismissing MUST leave the dashboard fully usable and MUST NOT write backend
  state.
- **FR-006**: The wizard and the in-app help MUST surface feature 010's existing **"send myself a test
  release"** CTA, which calls the existing authed `POST /api/deadman/test-release` (mints a one-time grant
  to the owner's own verified address); the CTA MUST be disabled/guarded with an explanation when no
  verified contact exists and MUST NOT call the endpoint in that case.
- **FR-007**: The test-release CTA's confirmation MUST be surfaced via an accessible live region, MUST
  explain that the user receives the email a contact would and that the link is view-once, and MUST disclose
  **no** token, grant, or note plaintext in the UI; a failure MUST be surfaced via `role="alert"` without
  falsely claiming a preview was sent.
- **FR-008**: The client MUST provide an always-available, accessible **in-app help/explainer** of the
  dead-man model (the `disarmed → active → grace → triggered` state machine, both check-in paths, the
  verified-contacts-only one-time secure release, instant disarm/pause, and the anti-premature-trigger
  safeguards), reachable from the dashboard regardless of first-run state, offering a control to
  (re-)launch the guided wizard, and containing no secret, token, or note plaintext.
- **FR-009**: The client MUST provide informative, accessible **empty states** across the dead-man UI (no
  contacts yet, no events yet, switch never armed) that name the next action rather than rendering a blank
  or cryptic placeholder.
- **FR-010**: The feature MUST refine feature 008's **countdown formatting** for legibility and screen
  readers (clear units, screen-reader-friendly text, urgency without colour alone) **without** changing the
  switch's timing semantics, the absolute-deadline clock, or any endpoint contract.
- **FR-011**: The feature MUST bring **all** dead-man UI from features 008–012 — the dashboard, config form,
  check-in control, events list, the public `/contact-verified`, `/r/:token`, and `/checked-in` pages, and
  the new wizard/help — to the constitution IV accessibility baseline: keyboard-navigable, semantic HTML,
  every input with a `<label htmlFor>`, status via `role="status" aria-live="polite"`, errors via
  `role="alert"`, visible focus, and WCAG AA contrast with no colour-only signalling.
- **FR-012**: The README **Architecture** section MUST describe the whole dead-man suite: the `deadman/`
  engine (`runDeadmanTick`/`evaluate`), the in-process driver + `npm run deadman:tick` CLI, the new tables
  (`deadman_config`, `deadman_event`, `release`, `release_grant`, `checkin_token`, the contact-verification
  columns), the public token routes (release view, contact verify, email check-in), the secure one-time
  release model, and the onboarding/help client layer.
- **FR-013**: The README **Run** section MUST give the exact ordered commands to start the app, including
  `npm run gen:api` codegen and how the in-process tick relates to the `npm run deadman:tick` CLI, with the
  resulting URLs/ports.
- **FR-014**: The README **Manual setup** section MUST document every new optional env var —
  `DEADMAN_TICK_MS`, `DEADMAN_TICK_DISABLED`, `APP_BASE_URL`, `DEADMAN_TEST_MODE` (and any other suite env)
  — by **name + purpose + where it goes**, with **no real secret values**; `server/.env.example` MUST list
  the same vars consistently.
- **FR-015**: The README **Tests** section MUST list the server (vitest/supertest), client (vitest/RTL), and
  e2e (Playwright) commands and variants, state the `DEADMAN_TICK_DISABLED=1` requirement so the in-process
  timer never runs during tests, and list the merge quality gates.
- **FR-016**: This feature MUST add **no** new backend endpoint, table, column, env var, or external
  service; it is a client-only onboarding/help/polish layer plus documentation over the data and endpoints
  features 008–011 already provide. (If any contract change is unavoidable it MUST go through
  `contracts/openapi.yaml` + `npm run gen:api`, never a hand-edit of `shared/src/api.ts` — but none is
  expected.)
- **FR-017**: The wizard, help, and all polish MUST keep note plaintext and tokens out of every rendered
  view and client-local store: nothing the onboarding layer displays or persists contains a release/check-in
  token, a grant, or note plaintext (the only secret remains the emailed one-time link from feature 010).

### Key Entities *(include if feature involves data)*

- **First-run state (derived, client-only)**: Not a stored entity. Computed from existing reads — the
  dead-man status (`state`, prior-arm signal), the note presence (`GET /api/note`), and the verified-contact
  presence (`GET /api/contact`). No new table, column, or flag.
- **Wizard UI state (client-local)**: Ephemeral per-session state — current step, completed steps, and the
  dismissed flag — held in client memory / `sessionStorage`. Never persisted to the backend; never contains
  a token or note plaintext.
- **Dead-man config (`deadman_config`)**: The per-user switch from feature 008. The wizard reads its status
  to detect first-run and drives the existing arm via `PUT /api/deadman/config`; it adds no column.
- **Dead-man event (`deadman_event`)**: The append-only audit log from feature 008. The wizard reads it to
  detect a prior `armed` event; it adds no event type.
- **Release (`release` / `release_grant`)**: Feature 010's release model. The "send myself a test release"
  CTA reuses the existing `POST /api/deadman/test-release` (owner's own verified address); the onboarding
  layer reads only the non-secret outcome, never a token or grant.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-run (never-armed) user is offered the guided wizard in 100% of dashboard loads where
  status is `disarmed` with no prior arm, and an already-armed user is auto-shown the wizard in **0** cases
  (it remains reachable from the help affordance).
- **SC-002**: A user who completes the wizard ends with the switch `active`, a verified contact, and a note
  present in 100% of completions; each step drives an **existing** endpoint and the wizard resumes at the
  first incomplete step for a returning never-armed user.
- **SC-003**: The wizard is dismissible at every step (Escape + labelled control), and after dismissal it
  re-appears on subsequent same-session navigation in **0** cases, while the dashboard remains fully usable.
- **SC-004**: The "send myself a test release" CTA calls the existing `POST /api/deadman/test-release` only
  when a verified contact exists (0 calls otherwise), confirms via an accessible live region, and discloses
  a token, grant, or note plaintext in the UI in **0** cases.
- **SC-005**: The in-app help/explainer renders the dead-man model and a re-launch-the-guide control, is
  reachable for both first-run and already-armed users, and contains a secret/token/plaintext in **0**
  cases — verified by component tests.
- **SC-006**: 100% of dead-man surfaces (008–012: dashboard, config form, check-in, events, the public
  `/contact-verified`, `/r/:token`, `/checked-in`, and the wizard/help) pass the accessibility assertions —
  keyboard-reachable, semantic, every input labelled, `role="status"`/`role="alert"` regions, no colour-only
  signalling, WCAG AA contrast — with **0** failures in the a11y test pass.
- **SC-007**: Empty states (no contacts, no events, never-armed) render informative next-action guidance in
  100% of those states, and the refined countdown announces legible, screen-reader-friendly remaining time
  while leaving timing semantics unchanged (verified by a countdown-formatting test).
- **SC-008**: All four README sections (Architecture, Run, Manual setup, Tests) accurately reflect the whole
  dead-man suite and `server/.env.example` lists the new env vars consistently, with **0** real secret
  values present (verified by inspection/CI README-relevance check).
- **SC-009**: The whole suite is green: `npm test` (server + client), `npm run typecheck`, and `npm run lint`
  pass, and the first-run e2e path (offered → step through → armed; plus dismiss) passes with
  `DEADMAN_TICK_DISABLED=1`.

## Assumptions

- **Engine + endpoints exist**: Features 008–011 already provide the liveness engine, the status/config/
  check-in endpoints (`GET /api/deadman`, `PUT /api/deadman/config`, `POST /api/deadman/checkin`), contact
  add + verify (`POST /api/contact`, `POST /api/contact/{id}/verify`), the note endpoints
  (`GET`/`PUT /api/note`), the secure one-time release, and the **existing** `POST /api/deadman/test-release`
  preview. This feature **consumes** them and adds none.
- **Client patterns exist**: The accessible, library-free React SPA with `apiFetch`-based per-endpoint
  clients (`deadmanClient.ts`, `contactClient.ts`, `noteClient.ts`, `releaseClient.ts`), `ProtectedRoute`,
  the `DeadmanDashboard`/`ContactList`/`NoteEditor` components, and the public pages
  (`ContactVerifiedPage`, `ReleaseViewPage`, `CheckedInPage`) already exist and are reused/refined.
- **Shared bounds exist**: The interval/grace bounds and defaults in `shared/src/constants.ts`
  (`CHECKIN_INTERVAL_MIN/MAX_SECONDS`, `GRACE_PERIOD_MIN/MAX_SECONDS`, `DEADMAN_DEFAULT_INTERVAL/GRACE_SECONDS`)
  are reused by the wizard's interval/grace step — no new bound is introduced.
- **No new backend**: This feature adds **no** endpoint, table, column, env var, or external service — it is
  a client-only onboarding/help/polish layer plus documentation. First-run detection and wizard state are
  derived from existing reads and client-local UI state.
- **Test seams exist**: `AUTH_TEST_MODE` (`POST /api/test/login`), the `DEADMAN_TEST_MODE` fast-forward
  seam, the capturing email provider, and `DEADMAN_TICK_DISABLED=1` (so the in-process timer never runs in
  tests) from features 008–011 are reused to drive the first-run e2e and any test-release preview
  assertions without real network/credentials.
- **README is the source of operational truth**: Per CLAUDE.md, the four README sections (and only those)
  are updated to reflect the whole suite, with `server/.env.example` kept in sync and no real secrets
  written.

## Dependencies

- Feature 008's dead-man status/config/check-in endpoints and the `DeadmanDashboard` component + dashboard
  page, the absolute-deadline countdown, the events list, and the shared interval/grace bounds — read,
  driven, and polished here.
- Feature 009's contact add + verify (the verify step + verified-contact detection) and the public
  `/contact-verified` page (included in the accessibility pass).
- Feature 010's secure one-time release + the existing `POST /api/deadman/test-release` preview endpoint and
  the public `/r/:token` view-once page (the test-release CTA + the a11y pass).
- Feature 011's email check-in links + the public `/checked-in` confirmation page (included in the
  accessibility pass).
- Feature 001/006's note (`GET`/`PUT /api/note`) and contact (`POST /api/contact`) endpoints driven by the
  wizard's note and contact steps.
- The accessible, library-free React SPA patterns (`apiFetch`, per-endpoint clients, `ProtectedRoute`,
  `NoteEditor`/`ContactList` accessibility patterns, plain-CSS `styles.css` with WCAG AA variables).
- The test seams (`AUTH_TEST_MODE`, `DEADMAN_TEST_MODE`, the capturing email provider,
  `DEADMAN_TICK_DISABLED=1`) for the first-run e2e and any preview assertions.
- `README.md` (the four sections) and `server/.env.example` as the single source of operational truth
  (CLAUDE.md), updated to reflect the whole dead-man suite.
