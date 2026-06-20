---

description: "Task list for Onboarding Tutorial & Guided Setup"
---

# Tasks: Onboarding Tutorial & Guided Setup

**Input**: Design documents from `/specs/012-onboarding-tutorial/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/onboarding.md, quickstart.md

**Tests**: MANDATORY (Constitution Principle I — TDD, NON-NEGOTIABLE). Each story's tests are written
before/alongside its implementation and must pass in CI before merge. **Every e2e test keeps
`DEADMAN_TICK_DISABLED=1`** (carried over from features 008–011) so the in-process timer never runs; the
first-run flow is driven via the existing endpoints + the `AUTH_TEST_MODE`/`DEADMAN_TEST_MODE` seams. The
onboarding layer renders/persists **no** token, grant, or note plaintext — the only secret is feature 010's
emailed one-time link (FR-007, FR-017).

**Organization**: Tasks are grouped by user story. The shared backbone (first-run detection helper, the
wizard shell, the dashboard wiring) lives in Setup/Foundational; each story then adds its
wizard-step/CTA/help/polish increment — all independently testable. This feature adds **no** server code and
**no** contract change; everything reuses the existing endpoints, clients, and components.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (guided first-run setup), US2 (preview a test release), US3 (in-app help/explainer),
  US4 (a11y pass + empty-state/countdown polish), US5 (whole-suite docs)
- Exact file paths are included in every task

## Path Conventions

Web-app npm workspaces: `client/src`, `client/tests`, `e2e/`, plus `README.md` and `server/.env.example` at
the repository root — per plan.md Structure Decision. **No** `server/src`, `contracts/`, or `shared/src`
changes (no new endpoint, table, contract, or constant). The onboarding components live under
`client/src/components/`, the pure helpers under `client/src/onboarding/`, and the dashboard wiring in
`client/src/pages/DeadmanDashboardPage.tsx`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The pure first-run/derivation helpers and the styles the onboarding layer needs, before any UI
consumes them.

- [ ] T001 [P] Create `client/src/onboarding/firstRun.ts` — pure helpers `isFirstRun(status, hasNote, contacts)` (true only when `status.state === "disarmed"` AND no prior arm — `last_checkin_at` null / no `armed` event) and `nextIncompleteStep(hasNote, hasVerifiedContact, isArmed)` (returns the first of: write-note → verify-contact → set-interval-grace → done), plus the session-scoped dismissed-flag accessor (`isWizardDismissed()`/`dismissWizard()` over `sessionStorage`) — derived from existing reads only, no backend call (FR-001, FR-003, FR-005)
- [ ] T002 [P] Create `client/src/onboarding/formatDuration.ts` — `formatDuration(seconds)` → human-readable interval/grace label (e.g. "7 days", "2 days") for the wizard's interval/grace step and the help (presentation-only)
- [ ] T003 [P] Add wizard/help/empty-state/countdown CSS classes to `client/src/styles.css` (WCAG AA contrast via existing CSS variables, visible focus states, no colour-only signalling; reuse existing dead-man classes where possible)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The dismissible wizard shell (offer/hide/resume/dismiss, session-scoped) and its dashboard
wiring that ALL stories build on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Create the `OnboardingWizard` shell in `client/src/components/OnboardingWizard.tsx` — reads `getStatus`/`getEvents` (deadmanClient), `GET /api/note` (noteClient), `GET /api/contact` (contactClient); uses `isFirstRun`/`nextIncompleteStep`/`isWizardDismissed` (T001) to decide whether to offer the wizard and which step to resume at; renders an accessible dialog/region with a semantic heading, a step indicator, an Escape handler + a labelled Dismiss/Skip control that calls `dismissWizard()` (session-scoped) and hides without writing backend state; non-blocking over the dashboard (FR-001–FR-005)
- [ ] T005 Wire the onboarding layer into `client/src/pages/DeadmanDashboardPage.tsx` — render `<OnboardingWizard/>` (offered on first-run, derived) above/alongside the existing `<DeadmanDashboard/>`, leaving the dashboard fully usable when the wizard is dismissed/absent (depends on T004)

**Checkpoint**: The wizard shell offers/hides/resumes/dismisses correctly on the dashboard — user stories can
begin.

---

## Phase 3: User Story 1 - Guided first-run setup (Priority: P1) 🎯 MVP

**Goal**: A never-armed user is walked, step by step, through write note → add & verify a contact → set
interval/grace → arm; each step reflects existing state and drives the existing endpoint; completing it
arms the switch and the wizard steps aside.

**Independent Test**: As a fresh user (`GET /api/deadman` = `disarmed`, no prior arm), load the dashboard,
assert the wizard is offered at the write-note step; save a note → step completes/advances; add + verify a
contact → advances; set interval/grace within bounds + confirm arm → switch `active`, wizard at completion;
assert a returning never-armed user with a note-but-no-verified-contact resumes at the contact step; assert
dismiss leaves the dashboard usable.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [ ] T006 [P] [US1] First-run detection + offer test: `OnboardingWizard` is offered when status is `disarmed` with no prior arm and is NOT auto-offered when ever-armed (status ever `active` / an `armed` event exists) — in `client/tests/components/OnboardingWizard.firstRun.test.tsx`
- [ ] T007 [P] [US1] Step progress/resume test: each step reflects existing state (note present → write-note complete; a verified contact present → verify-contact complete; armed → set-interval-grace complete) and the wizard resumes at the first incomplete step (e.g. note exists but no verified contact → resume at verify-contact); the final step calls the existing `putConfig` (arm) after an explicit confirm and the wizard moves to completion — in `client/tests/components/OnboardingWizard.steps.test.tsx`
- [ ] T008 [P] [US1] Dismiss test: Escape and the labelled Dismiss/Skip control hide the wizard, persist the dismissal for the session (so it does not re-appear on re-render/navigation), leave the dashboard fully usable, and write NO backend state — in `client/tests/components/OnboardingWizard.dismiss.test.tsx`

### Implementation for User Story 1

- [ ] T009 [US1] Implement the **write-note** step in `client/src/components/OnboardingWizard.tsx` — reuse the existing `NoteEditor` flow / `noteClient` (`PUT /api/note`); mark complete from the existing note read and advance (FR-002, FR-003) (depends on T004)
- [ ] T010 [US1] Implement the **add & verify a contact** step — reuse the existing `ContactList` flow / `contactClient` (`POST /api/contact`, `POST /api/contact/{id}/verify`); mark complete once at least one contact is verified (from the existing contact read) and advance (FR-002, FR-003) (depends on T004)
- [ ] T011 [US1] Implement the **set interval/grace & arm** step — an interval/grace form bounded by the shared `CHECKIN_INTERVAL_MIN/MAX_SECONDS`/`GRACE_PERIOD_MIN/MAX_SECONDS` (reuse), an explicit confirm before the first arm (roadmap §6), then call the existing `putConfig` (arm); on success advance to the completion state and step the wizard aside (FR-004) (depends on T004)
- [ ] T012 [US1] Implement the completion state + "once armed, not auto-shown" behaviour — after arming (or when ever-armed) the wizard is not auto-offered but remains relaunchable from the help affordance (US3); confirm via T006/T007 (depends on T009–T011)

**Checkpoint**: A never-armed user can be guided to a correctly-armed switch with a verified contact and a
note — US1 independently testable; this is the core "de-risk first use" value the roadmap needs.

---

## Phase 4: User Story 2 - Preview what my contacts will receive (Priority: P1)

**Goal**: The wizard (and the help) surface feature 010's existing "send myself a test release" CTA so a
first-timer can preview exactly what their contacts receive before arming — guarded on a verified contact,
disclosing no secret.

**Independent Test**: With a verified contact, activate the CTA → it calls the existing
`POST /api/deadman/test-release` and confirms (accessible live region) a preview was sent to the owner's own
verified address, explaining the email mirrors a contact's and the link is view-once; with NO verified
contact the CTA is disabled/guarded with an explanation and does not call the endpoint; the UI never shows a
token or note plaintext; a failure surfaces via `role="alert"` without falsely claiming success.

### Tests for User Story 2 ⚠️ (write first, ensure they FAIL)

- [ ] T013 [P] [US2] Test-release CTA test: with a verified contact the CTA calls the existing `testRelease` client (`POST /api/deadman/test-release`) and renders a `role="status"` confirmation explaining the preview email + view-once link, disclosing NO token/grant/note plaintext; with no verified contact the CTA is disabled/guarded with an explanation and does NOT call the endpoint; a thrown error renders via `role="alert"` without claiming success — in `client/tests/components/OnboardingWizard.testRelease.test.tsx`

### Implementation for User Story 2

- [ ] T014 [US2] Surface the "send myself a test release" CTA in `client/src/components/OnboardingWizard.tsx` (and expose it for reuse by `DeadmanHelp` in US3) — reuse the existing `testRelease` client (feature 010, `releaseClient`/`deadmanClient`); guard it on the presence of a verified contact (from the existing contact read); render the accessible confirmation/error and the "view-once" / "this is what your contacts receive" explanation; never render a token/grant/plaintext (FR-006, FR-007, FR-017) (depends on T004, T010)
- [ ] T015 [US2] Also surface the same guarded test-release CTA on the dashboard via `client/src/components/DeadmanDashboard.tsx` confirmation region (reuse the existing `testRelease` client; `role="status"`/`role="alert"`), so the preview is reachable outside the wizard too (FR-006) (depends on T014)

**Checkpoint**: A first-timer can safely preview the exact recipient experience before arming — US1+US2
independently functional; the trust-building path is wired with no new backend.

---

## Phase 5: User Story 3 - In-app help / explainer of the dead-man model (Priority: P2)

**Goal**: An always-available, accessible "How this works" explainer of the dead-man model, reachable
whether or not the user is first-run, with a control to (re-)launch the guided wizard.

**Independent Test**: Open the explainer from the dashboard → assert it renders the model (states, both
check-in paths, the one-time verified-contact release, disarm/pause, anti-premature-trigger safeguards) as
semantic, keyboard-navigable content with no secret/token/plaintext; assert a "Show me / restart the guide"
control relaunches the wizard at its first incomplete step; assert it is reachable for both first-run and
already-armed users and is Escape-dismissible with focus management.

### Tests for User Story 3 ⚠️ (write first, ensure they FAIL)

- [ ] T016 [P] [US3] Help/explainer test: `DeadmanHelp` renders the dead-man model content (states, both check-in paths, one-time verified-contact release, disarm/pause, safeguards) with semantic headings, is keyboard-navigable and Escape-dismissible with focus return, exposes a control that (re-)launches `OnboardingWizard`, is reachable for first-run AND already-armed users, and contains NO secret/token/note plaintext — in `client/tests/components/DeadmanHelp.test.tsx`

### Implementation for User Story 3

- [ ] T017 [US3] Create `client/src/components/DeadmanHelp.tsx` — an accessible "How this works" explainer (semantic headings, keyboard nav, Escape + labelled close, focus management) describing the dead-man model and offering a "(re)start the guide" control that opens `OnboardingWizard` (at the first incomplete step); reuse the US2 test-release CTA where helpful; no secret/token/plaintext (FR-008) (depends on T004, T014)
- [ ] T018 [US3] Mount the persistent "How this works" affordance in `client/src/pages/DeadmanDashboardPage.tsx` (and/or `DeadmanDashboard.tsx`) so it is reachable regardless of first-run state and relaunches the wizard on demand (FR-008) (depends on T017)

**Checkpoint**: Every user (first-run or returning) has a durable, accessible reference for the model and can
relaunch the guide — US1–US3 independently functional.

---

## Phase 6: User Story 4 - Accessibility pass + empty-state & countdown polish (Priority: P2)

**Goal**: All dead-man UI from 008–012 meets the constitution IV accessibility baseline; empty states are
informative; the feature-008 countdown is legible + screen-reader-friendly without changing timing
semantics.

**Independent Test**: Run keyboard/semantic/`role`/contrast assertions over each dead-man surface
(dashboard, config form, check-in, events, `/contact-verified`, `/r/:token`, `/checked-in`, wizard, help);
assert empty states (no contacts, no events, never armed) render next-action guidance; assert the refined
countdown announces legible remaining time with unchanged timing semantics.

### Tests for User Story 4 ⚠️ (write first, ensure they FAIL)

- [ ] T019 [P] [US4] Countdown-formatting test: extract/refine `formatCountdown` (e.g. to `client/src/onboarding/countdown.ts`) and assert it renders legible units + screen-reader-friendly text for a range of remaining seconds (days/hours/minutes/seconds, "due now"), conveys urgency without colour alone, and leaves the underlying absolute-deadline timing unchanged — in `client/tests/components/DeadmanDashboard.countdown.test.tsx`
- [ ] T020 [P] [US4] Empty-state test: the dead-man UI renders informative, accessible empty states naming the next action for (a) no contacts yet, (b) no events yet, (c) switch never armed — assert in the relevant existing component tests (`ContactList`, `DeadmanDashboard` events) / a new `EmptyState` test
- [ ] T021 [P] [US4] Accessibility-assertion pass: strengthen the existing dead-man component/page tests (dashboard, config form, check-in, events, `ContactVerifiedPage`, `ReleaseViewPage`, `CheckedInPage`, `OnboardingWizard`, `DeadmanHelp`) to assert keyboard reachability, semantic headings/landmarks, every input labelled (`<label htmlFor>`), `role="status"`/`role="alert"` regions, and no colour-only signalling (FR-011, SC-006)

### Implementation for User Story 4

- [ ] T022 [US4] Refine the countdown in `client/src/components/DeadmanDashboard.tsx` — use the extracted/legible `formatCountdown` (T019), screen-reader-friendly text, urgency without colour alone; keep the absolute-deadline timing semantics unchanged (FR-010) (depends on T019)
- [ ] T023 [P] [US4] Create `client/src/components/EmptyState.tsx` (small, accessible) and use it for the no-events list in `DeadmanDashboard.tsx` and the no-contacts state in `ContactList.tsx` (informative next-action guidance) (FR-009) (depends on T020)
- [ ] T024 [US4] Accessibility-pass corrective edits across the dead-man surfaces — `client/src/components/DeadmanDashboard.tsx`, `ContactList.tsx`, `OnboardingWizard.tsx`, `DeadmanHelp.tsx`, and the public pages `client/src/pages/ContactVerifiedPage.tsx`, `ReleaseViewPage.tsx`, `CheckedInPage.tsx`: ensure keyboard nav, semantic HTML, every input `<label htmlFor>`, `role="status" aria-live="polite"`/`role="alert"`, visible focus, WCAG AA contrast, no colour-only signalling (FR-011) (depends on T021)

**Checkpoint**: The whole 008–012 dead-man UI is accessible and polished (informative empty states + a
legible countdown) with unchanged timing — US1–US4 independently functional; the constitution IV gate is met.

---

## Phase 7: User Story 5 - Whole-suite documentation (Priority: P2)

**Goal**: All four README sections + `server/.env.example` reflect the entire dead-man suite (008–012), with
no real secrets.

**Independent Test**: Inspect `README.md` and `server/.env.example` and assert Architecture/Run/Manual
setup/Tests accurately describe the suite (engine + driver + `deadman:tick` CLI, the new tables, the public
token routes, the one-time release, the onboarding/help layer; ordered run commands incl. `gen:api`; the new
optional env vars by name/purpose/location; the test commands + `DEADMAN_TICK_DISABLED=1` + merge gates) and
that no real secret values are present.

### Implementation for User Story 5

- [ ] T025 Update `README.md` **Architecture** — the `deadman/` module (`runDeadmanTick`/`evaluate`, `config-repo`/`event-repo`/`release-repo`/`tokens`/`driver`), the in-process driver + `npm run deadman:tick` CLI, the new tables (`deadman_config`, `deadman_event`, `release`, `release_grant`, `checkin_token`, the contact-verification columns), the public token routes (release view, contact verify, email check-in), the secure one-time release model, and the onboarding/help client layer (FR-012)
- [ ] T026 Update `README.md` **Run** — the exact ordered commands incl. `npm run gen:api` and how the in-process tick relates to `npm run deadman:tick`, with the resulting URLs/ports (FR-013)
- [ ] T027 Update `README.md` **Manual setup** + `server/.env.example` — document `DEADMAN_TICK_MS`, `DEADMAN_TICK_DISABLED`, `APP_BASE_URL`, `DEADMAN_TEST_MODE` (and any other suite env) by name + purpose + where it goes, with NO real secret values, and keep `server/.env.example` consistent (FR-014)
- [ ] T028 Update `README.md` **Tests** — the server (vitest/supertest), client (vitest/RTL), and e2e (Playwright) commands/variants, the `DEADMAN_TICK_DISABLED=1` requirement so the timer never runs in tests, and the merge quality gates (FR-015)

**Checkpoint**: The README is the accurate single source of operational truth for the whole suite — US5
independently verifiable by inspection / the CI README-relevance check.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end coverage of the first-run path, a no-secret cross-cutting assertion, and the quality
gates.

- [ ] T029 [P] Cross-cutting assertion: across the onboarding component tests, assert the wizard, help, and test-release confirmation render/persist NO token, grant, or note plaintext (the only secret is feature 010's emailed one-time link) — fold into `OnboardingWizard.testRelease.test.tsx` / `DeadmanHelp.test.tsx` (FR-007, FR-017, SC-004/SC-005)
- [ ] T030 Create `e2e/onboarding.spec.ts` (Playwright): `loginAs` a fresh user → wizard offered at write-note → write a note → add + verify a contact (via the verify flow) → set interval/grace → confirm arm → assert the switch is `active` and the wizard steps aside; plus a dismiss path (Escape/Skip → wizard hidden, dashboard usable); keep `DEADMAN_TICK_DISABLED=1` and reuse the `AUTH_TEST_MODE`/`DEADMAN_TEST_MODE` seams
- [ ] T031 [P] Run the full gates + quickstart validation: `npm run typecheck`, `npm test` (server + client), `npm run lint`, `npm run test:e2e`, and the manual steps in `quickstart.md` (SC-009)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001/T002/T003 are all [P] (different files) — independent.
- **Foundational (Phase 2)**: Depends on Setup (the first-run helper + styles). BLOCKS all stories. T004
  (wizard shell) precedes T005 (dashboard wiring).
- **User Stories (Phase 3–7)**: All depend on Foundational. Implemented in priority order
  (US1 → US2 → US3 → US4 → US5). US1/US2/US3 grow the same `OnboardingWizard.tsx` (and `DeadmanDashboard`/
  `DeadmanHelp`), so those impl tasks are **sequential by design**; US4 is a corrective pass over existing
  surfaces + the new components; US5 (docs) is independent of the UI code once the suite behaviour is known.
- **Polish (Phase 8)**: T029 after the onboarding components; T030 after the full first-run UI; T031 last.

### Within Each User Story

- Tests (the `### Tests` block) are written first and must FAIL before implementation.
- The first-run helper + wizard shell (Foundational) before the steps; the steps before the completion
  behaviour; the verify-contact step before the test-release CTA (which needs a verified contact); the CTA
  before the help (which reuses it).
- US1 must precede US2/US3 (same wizard file) and US4's wizard a11y pass; each story remains independently
  testable at its checkpoint.

### Parallel Opportunities

- All Setup tasks (T001, T002, T003) run in parallel.
- Each story's `### Tests` tasks ([P]) run together (distinct files): T006/T007/T008; T013; T016;
  T019/T020/T021.
- The empty-state component (T023) and the cross-cutting/gate tasks (T029, T031) are [P] relative to their
  siblings.
- The README/`.env.example` tasks (T025–T028) are largely independent of the UI tasks and of each other
  (different sections/files), though committed alongside the relevant code slice per CLAUDE.md.

---

## Parallel Example: User Story 1

```bash
# Write US1 tests together first (distinct files):
Task: "First-run detection + offer test in client/tests/components/OnboardingWizard.firstRun.test.tsx"   # T006
Task: "Step progress/resume test in client/tests/components/OnboardingWizard.steps.test.tsx"             # T007
Task: "Dismiss test in client/tests/components/OnboardingWizard.dismiss.test.tsx"                          # T008

# Then implement (Setup helpers first, in parallel where [P]):
Task: "Create client/src/onboarding/firstRun.ts"                                                          # T001 (setup)
Task: "Create client/src/onboarding/formatDuration.ts"                                                    # T002 (setup)
Task: "Add wizard/help/empty-state/countdown CSS to client/src/styles.css"                                # T003 (setup)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & VALIDATE**: a never-armed user is
   guided through note → verify contact → interval/grace → arm and ends with an `active` switch; dismiss
   leaves the dashboard usable. Deploy/demo.

### Incremental Delivery (matches plan.md PR slices)

1. Setup + Foundational + US1 → MVP (guided first-run setup to an armed switch).
2. US2 (the guarded "send myself a test release" preview CTA) → CTA tests green → demo.
3. US3 (the always-available help/explainer + relaunch) → help test green → demo.
4. US4 (a11y pass across 008–012 + empty states + legible countdown) → a11y/countdown/empty-state tests
   green → demo.
5. US5 (the four-section README + `server/.env.example`) → inspection/README-relevance check.
6. Polish (no-secret assertion, first-run e2e, full gates).

Each story adds value without breaking the previous; commit after each task or logical group as its own
bisectable `feat:` commit on the single feature branch.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- Shared files (`OnboardingWizard.tsx`, `DeadmanDashboard.tsx`, `DeadmanHelp.tsx`,
  `DeadmanDashboardPage.tsx`) are intentionally grown across stories in priority order — that's why those
  impl tasks are NOT marked [P] across phases.
- **No backend change**: this feature adds no endpoint, table, column, env var, or external service; first-run
  is derived from existing reads and wizard state is client-local `sessionStorage`. The
  `contracts/openapi.yaml` and `shared/src/api.ts` are UNCHANGED (no `gen:api` run).
- Every wizard step drives an **existing** endpoint: write note (`PUT /api/note`), add contact
  (`POST /api/contact`), verify (`POST /api/contact/{id}/verify`), set interval/grace + arm
  (`PUT /api/deadman/config`); the preview reuses `POST /api/deadman/test-release` (feature 010, owner's own
  verified address).
- The onboarding layer renders/persists **no** token, grant, or note plaintext — the only secret is feature
  010's emailed one-time link (FR-007, FR-017).
- Polish is presentation-only: the empty states and the refined countdown never change timing semantics, the
  absolute-deadline clock, or any endpoint contract (FR-010).
- The accessibility pass is corrective/verifying work over the existing 008–011 surfaces + the new
  components, bringing them all to the constitution IV baseline (FR-011).
- README is the single source of operational truth (CLAUDE.md): only the four allowed sections are updated to
  reflect the whole suite, `server/.env.example` is kept in sync, and no real secret values are written.
- Verify each story's tests fail before implementing it; keep `DEADMAN_TICK_DISABLED=1` in the e2e.
```
