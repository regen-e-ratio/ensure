# Implementation Plan: Onboarding Tutorial & Guided Setup

**Branch**: `feat/deadman-switch` (feature `012-onboarding-tutorial`) | **Date**: 2026-06-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-onboarding-tutorial/spec.md`

## Summary

Teach the dead-man model and **de-risk first use**, then do the final polish + whole-suite docs. On the
dashboard, detect a **first-run** (never-armed) user **purely from existing reads** — `GET /api/deadman`
reporting `disarmed` with no prior arm (`last_checkin_at` null / no `armed` event) — and offer a
**dismissible, fully accessible guided wizard** that explains the `disarmed → active → grace → triggered`
model and walks the user, step by step, through the four prerequisites for a working switch: **write a
note** (`PUT /api/note`), **add & verify a contact** (`POST /api/contact` + `POST /api/contact/{id}/verify`),
**set interval/grace and arm** (`PUT /api/deadman/config`, with an explicit confirm before the first arm).
Each step **reflects existing state** (note present, verified contact present, switch armed) and the wizard
**resumes at the first incomplete step**. The wizard surfaces feature 010's existing **"send myself a test
release"** CTA (`POST /api/deadman/test-release`, owner's own verified address) so a first-timer can
**preview exactly what their contacts receive** before arming — building trust without "dying". An
always-available, accessible **in-app help/explainer** documents the model and re-launches the wizard on
demand.

Polish is presentation-only: **informative empty states** across the dead-man UI and a **legible,
screen-reader-friendly refinement of feature 008's countdown** (no timing-semantics change). A full
**accessibility pass** brings **all** dead-man UI from features 008–012 — the dashboard, config form,
check-in control, events list, the public `/contact-verified`, `/r/:token`, and `/checked-in` pages, and
the new wizard/help — to the constitution IV baseline (keyboard, semantic HTML, labelled controls,
`role="status"`/`role="alert"`, visible focus, WCAG AA, no colour-only signalling). Finally, **all four
README sections** (Architecture, Run, Manual setup incl. the new env vars + `npm run deadman:tick`, Tests)
and **`server/.env.example`** are updated to reflect the whole dead-man suite.

This feature adds **no** new backend endpoint, table, column, env var, or external service. First-run
detection and wizard state are derived from existing reads and **client-local** UI state (e.g.
`sessionStorage`); every step drives an **existing** endpoint. It is a client-only onboarding/help/polish
layer plus documentation over the data and endpoints features 008–011 already provide.

## Technical Context

**Language/Version**: TypeScript 5.6+ on Node.js 22 (server, run via `tsx`, ESM) and the browser SPA
(client); unchanged from 001/002/004/006/008/009/010/011.

**Primary Dependencies**: React 18 + React Router (client SPA), the existing `apiFetch`-based per-endpoint
clients (`deadmanClient.ts`, `contactClient.ts`, `noteClient.ts`), and the existing
`DeadmanDashboard`/`ContactList`/`NoteEditor` components and public pages — all reused. **No new runtime
dependency** and **no new server code** (no Express route, repo, or table): the wizard, help, and polish are
client components + plain CSS; first-run detection is derived from existing reads. (KISS/YAGNI — reuse the
existing endpoints, clients, and components; add no backend and no UI library.)

**Storage**: **None added.** No new table, column, or migration. First-run state is **derived** from
existing reads (`GET /api/deadman`, `GET /api/note`, `GET /api/contact`); wizard step/dismissal state is
**client-local** (`sessionStorage`), never persisted to the backend. No note access and no token handling in
this feature (the only secret, the release link, stays in feature 010's emailed one-time link).

**Testing**: Vitest + React Testing Library (client component tests for the wizard steps, the help/explainer,
the test-release CTA guard, the empty states, and the refined countdown formatting) and Playwright e2e (the
first-run path: offered → step through note → add+verify contact → set interval/grace → arm → wizard steps
aside; plus dismiss leaves the dashboard usable). The e2e reuses `AUTH_TEST_MODE`, the `DEADMAN_TEST_MODE`
fast-forward seam, and the capturing email provider, and keeps **`DEADMAN_TICK_DISABLED=1`** so the
in-process timer never runs. No new server tests are required (no new endpoint), though the accessibility
pass adds/strengthens assertions on the existing dead-man component/page tests.

**Target Platform**: Existing browser SPA served by the existing single Node process; single-instance deploy.

**Project Type**: Web application (existing npm workspaces `client/`, `server/`, `shared/`).

**Performance Goals**: The wizard only reads what the dashboard already loads (status, note, contacts) and
holds ephemeral UI state — no extra round-trips beyond the existing endpoint calls each step already makes.
No change to the local p95 < 200 ms target (no new synchronous endpoint).

**Constraints**:
- **No new backend**: no endpoint, table, column, env var, or external service (FR-016); if any contract
  change were unavoidable it would go through `contracts/openapi.yaml` + `npm run gen:api`, never a
  hand-edit of `shared/src/api.ts` — but **none is expected**.
- **First-run from existing reads only**: detection is derived from `GET /api/deadman` (`disarmed` + no prior
  arm) plus note/contact presence; **no** new backend flag (FR-001, FR-003).
- **Dismissible, non-blocking, session-scoped**: the wizard is dismissible (Escape + labelled control), never
  blocks direct dashboard use, never writes backend state, and its dismissal persists for the session via
  client-local storage (FR-005).
- **Explicit confirm before first arm**: arming is the final, explicitly-confirmed step (roadmap §6,
  premature-trigger safeguard) (FR-004).
- **Test-release CTA reuse + guard**: the CTA calls the **existing** `POST /api/deadman/test-release` only
  when a verified contact exists; otherwise it is disabled/guarded and does not call the endpoint (FR-006).
- **No secret in the onboarding layer**: the wizard, help, and test-release confirmation display/persist no
  token, grant, or note plaintext — the only secret is the emailed one-time link (feature 010) (FR-007,
  FR-017).
- **Polish is presentation-only**: empty-state and countdown changes never alter timing semantics, the
  absolute-deadline clock, or any endpoint contract (FR-010).
- **Accessibility baseline (constitution IV)** across all 008–012 dead-man UI: keyboard-navigable, semantic
  HTML, every input with a `<label htmlFor>`, status via `role="status" aria-live="polite"`, errors via
  `role="alert"`, visible focus, WCAG AA contrast, no colour-only signalling (FR-011).
- **README is the single source of operational truth** (CLAUDE.md): exactly the four sections are updated to
  reflect the whole suite, with `server/.env.example` kept in sync and **no real secret values** written
  (FR-012–FR-015).

**Scale/Scope**: Small number of users. New: a guided wizard component (with note/contact/interval-grace/arm
steps), an in-app help/explainer component, the test-release CTA surfaced in both, informative empty states,
a refined countdown formatter, an accessibility pass over the existing dead-man surfaces, client component +
e2e tests, and the four-section README + `server/.env.example` updates. No server code, no contract change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|-----------|--------|----------------------------|
| I | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Tests written with/before code at every layer. **Client (RTL)** — first-run detection offers the wizard only when status is `disarmed` with no prior arm (and not when ever-armed); each wizard step reflects existing state and advances/resumes at the first incomplete step; the final step arms via the existing config endpoint after an explicit confirm; dismiss (Escape + control) hides it for the session and leaves the dashboard usable; the "send myself a test release" CTA calls `POST /api/deadman/test-release` only with a verified contact (guarded otherwise) and never shows a token/plaintext; the help/explainer renders the model + a re-launch control and is reachable for first-run and already-armed users; the empty states render next-action guidance; the refined countdown announces legible, screen-reader-friendly remaining time with unchanged semantics. **A11y assertions** across all 008–012 surfaces (keyboard, labelled inputs, `role="status"`/`role="alert"`, no colour-only). **e2e (Playwright)** — first-run path offered → note → add+verify contact → interval/grace → arm → wizard steps aside (plus a dismiss path), with `DEADMAN_TICK_DISABLED=1`. All wired into CI; merge blocked unless green. |
| II | Keep It Simple | ✅ PASS | Smallest design meeting the spec: **no new backend** (no endpoint, table, column, env var, or service); first-run is **derived** from existing reads and wizard state is **client-local** (`sessionStorage`) — no new persistence; the wizard **reuses** the existing note/contact/verify/config/test-release endpoints and the existing `NoteEditor`/`ContactList`/`DeadmanDashboard` components and clients rather than re-implementing them; the test-release CTA **reuses** feature 010's existing endpoint; the help/explainer is plain accessible content; polish is presentation-only (an empty-state component + a countdown formatter), not a behaviour change; **no UI library** is added. → Complexity Tracking left empty. |
| III | Typed End to End | ✅ PASS | All new client code is TypeScript with explicit prop/return types; it consumes the **existing** generated `shared/src/api.ts` types via the existing per-endpoint clients (`DeadmanStatus`, `DeadmanEvent`, contact/note types) — no `any`, no new contract surface. Wizard step state is a typed discriminated union; first-run detection is a typed pure function over the existing status/note/contact reads. `tsc --noEmit` in CI. Because there is no new endpoint, `contracts/openapi.yaml`/`shared/src/api.ts` are **unchanged** (no hand-edit). |
| IV | Accessible by Default | ✅ PASS | This feature is largely an **accessibility deliverable**: the wizard and help are keyboard-navigable with semantic headings, focus management (Escape to dismiss, focus return), every input with a `<label htmlFor>`, `role="status" aria-live="polite"` for progress/confirmations and `role="alert"` for errors, no colour-only signalling, WCAG AA contrast; the pass also **brings the existing** 008–011 dead-man surfaces (dashboard, config form, check-in, events, `/contact-verified`, `/r/:token`, `/checked-in`) to the same baseline, and the refined countdown + empty states are explicitly accessible. Verified by component + e2e a11y assertions. |
| V | Small Pull Requests | ✅ PASS | Sliced into independently reviewable steps: **(1)** first-run detection helper + wizard shell (offer/dismiss/resume, session-scoped) + its tests; **(2)** the wizard steps (note → add+verify contact → interval/grace+arm) reusing the existing components/endpoints + step tests; **(3)** the "send myself a test release" CTA (surfaced in wizard + help, guarded on verified-contact) + tests; **(4)** the in-app help/explainer + re-launch control + tests; **(5)** the accessibility pass + empty-state + countdown-formatting polish across 008–012 + a11y tests; **(6)** the first-run e2e + the four-section README + `server/.env.example` updates. Each is reviewable in one sitting and committed as its own bisectable `feat:` commit on the single feature branch (per roadmap §5). |

**Merge gates** (constitution Development Workflow): a PR merges only when (1) tests pass,
(2) `tsc` type-check passes, and (3) the new/updated UI meets the accessibility baseline.

**Result**: PASS. No violations requiring justification → Complexity Tracking left empty.

**Post-design re-check (after Phase 1)**: Still PASS. No new backend endpoint, table, column, env var, or
service is introduced; first-run detection is derived from existing reads and wizard state is client-local;
every step drives an existing endpoint; the test-release CTA reuses feature 010's endpoint; the onboarding
layer renders no token/grant/note plaintext; the accessibility pass and polish are corrective/presentation
work over existing surfaces; the README updates touch exactly the four allowed sections with no real
secrets. All five principles remain satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/012-onboarding-tutorial/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification (+ Clarifications)
├── research.md          # Phase 0 output — decisions (first-run from existing reads only; client-local
│                        #   session-scoped wizard state; reuse existing endpoints/components; reuse 010's
│                        #   test-release CTA; presentation-only polish; whole-suite a11y baseline)
├── data-model.md        # Phase 1 output — NO new persisted entities; documents the derived first-run state
│                        #   and the client-local wizard UI state (step/completed/dismissed)
├── quickstart.md        # Phase 1 output — sign in fresh, follow the wizard end to end (note → verify contact
│                        #   → interval/grace → arm), preview a test release, open the help
├── contracts/
│   └── onboarding.md    # Phase 1 — NO new HTTP contract; documents which EXISTING endpoints each wizard step
│                        #   drives (PUT /note, POST /contact, POST /contact/{id}/verify, PUT /deadman/config,
│                        #   POST /deadman/test-release) and the reads used for first-run detection
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root) — additions/changes to the existing layout

```text
contracts/openapi.yaml                  # UNCHANGED — no new endpoint (the wizard drives existing routes)
shared/src/api.ts                       # UNCHANGED — not regenerated (no contract change)
shared/src/constants.ts                 # (REUSE) CHECKIN_INTERVAL_MIN/MAX_SECONDS, GRACE_PERIOD_MIN/MAX_SECONDS,
                                        #         DEADMAN_DEFAULT_INTERVAL/GRACE_SECONDS — no new constant

server/                                 # NO source changes (no new endpoint/repo/table). The existing test seams
                                        #   (AUTH_TEST_MODE, DEADMAN_TEST_MODE, capturing email provider,
                                        #   DEADMAN_TICK_DISABLED=1) are reused by the e2e
└── .env.example                        # UPDATE: keep in sync with README Manual setup — the new optional
                                        #   dead-man env vars (DEADMAN_TICK_MS, DEADMAN_TICK_DISABLED,
                                        #   APP_BASE_URL, DEADMAN_TEST_MODE) documented by name + purpose (no
                                        #   real secrets) [already present from 008; verify/finalize wording]

client/
├── src/
│   ├── pages/
│   │   └── DeadmanDashboardPage.tsx    # EDIT: render the onboarding layer — offer <OnboardingWizard/> on
│   │   │                                #       first-run (derived) and a persistent "How this works"
│   │   │                                #       (<DeadmanHelp/>) affordance regardless of first-run state
│   │   └── (ContactVerifiedPage.tsx,   # ACCESSIBILITY PASS (FR-011): verify keyboard reachability, semantic
│   │   │    ReleaseViewPage.tsx,       #   headings/landmarks, role=status/alert, no colour-only, WCAG AA;
│   │   │    CheckedInPage.tsx)         #   corrective edits only (no behaviour change)
│   ├── components/
│   │   ├── OnboardingWizard.tsx        # NEW: dismissible, accessible guided wizard — first-run detection
│   │   │                                #      (offer/hide), session-scoped dismissal, step progress + resume
│   │   │                                #      at first incomplete step; each step reuses the existing
│   │   │                                #      NoteEditor/ContactList flows + the config/arm form; Escape +
│   │   │                                #      labelled Dismiss/Skip; surfaces the test-release CTA; explicit
│   │   │                                #      confirm before the first arm (no new endpoint)
│   │   ├── DeadmanHelp.tsx             # NEW: always-available accessible explainer of the dead-man model
│   │   │                                #      (states, both check-in paths, one-time verified-contact release,
│   │   │                                #      disarm/pause, anti-premature-trigger safeguards) + a control to
│   │   │                                #      (re-)launch the wizard; no secret/token/plaintext
│   │   ├── EmptyState.tsx              # NEW (optional, small): informative accessible empty-state used by the
│   │   │                                #      dead-man UI (no contacts / no events / never armed)
│   │   ├── DeadmanDashboard.tsx        # EDIT: refine the countdown formatting (legible units +
│   │   │                                #      screen-reader-friendly text, urgency without colour alone;
│   │   │                                #      timing semantics UNCHANGED); use <EmptyState/> for the no-events
│   │   │                                #      empty list; a11y pass; surface the test-release CTA confirmation
│   │   │                                #      via role=status (reuse existing testRelease client)
│   │   └── ContactList.tsx             # ACCESSIBILITY PASS + empty state (no contacts yet) — corrective edits
│   ├── onboarding/
│   │   └── firstRun.ts                 # NEW: pure helpers — isFirstRun(status, note, contacts) and
│   │   │                                #      nextIncompleteStep(...) derived from existing reads; the
│   │   │                                #      session-scoped dismissed flag (sessionStorage) accessor
│   │   └── countdown.ts                # NEW (optional): the refined formatCountdown(seconds) extracted as a
│   │   │                                #      pure, unit-tested formatter (moved out of DeadmanDashboard) so
│   │   │                                #      it can be tested in isolation; timing semantics unchanged
│   │   └── formatDuration.ts           # NEW (optional): human-readable interval/grace labels for the wizard's
│   │   │                                #      interval/grace step and the help (e.g. "7 days")
│   │   └── (REUSE) deadmanClient.ts,   # client/src/api/* — the wizard reads getStatus/getEvents, drives
│   │   │    contactClient, noteClient, #   putConfig (arm), and calls testRelease; the verify step uses the
│   │   │    releaseClient(testRelease) #   existing contact verify client — NO new client module
│   └── styles.css                      # ADD/REFINE: wizard, help, empty-state, and countdown classes (WCAG AA
│   │                                    #      contrast via existing CSS variables, visible focus states, no
│   │                                    #      colour-only signalling); reuse existing dead-man classes
└── tests/
    ├── components/
    │   ├── OnboardingWizard.firstRun.test.tsx   # offered only when never-armed; not when ever-armed
    │   ├── OnboardingWizard.steps.test.tsx      # step progress/resume; arm via existing config endpoint
    │   ├── OnboardingWizard.dismiss.test.tsx    # Escape + control; session-scoped; dashboard stays usable
    │   ├── OnboardingWizard.testRelease.test.tsx# CTA guarded on verified contact; no token/plaintext shown
    │   ├── DeadmanHelp.test.tsx                 # renders the model + re-launch; reachable both states; no secret
    │   ├── DeadmanDashboard.countdown.test.tsx  # refined countdown formatting (legible + a11y, semantics same)
    │   └── (a11y assertions folded into the existing dead-man component tests — FR-011)
    └── (e2e below)

e2e/
├── support/                            # (REUSE) loginAs, the capturing email provider, the DEADMAN_TEST_MODE seam
└── onboarding.spec.ts                  # NEW: fresh sign-in → wizard offered → write note → add + verify a
                                        #   contact → set interval/grace → confirm arm → switch active + wizard
                                        #   steps aside; plus a dismiss path (wizard hidden, dashboard usable);
                                        #   keep DEADMAN_TICK_DISABLED=1

README.md                               # UPDATE all four sections to reflect the WHOLE dead-man suite (008–012):
                                        #   Architecture (deadman/ engine + driver + CLI, the new tables, the
                                        #   public token routes, the one-time release, the onboarding/help layer);
                                        #   Run (ordered commands incl. gen:api + how the in-process tick relates
                                        #   to `npm run deadman:tick`); Manual setup (DEADMAN_TICK_MS,
                                        #   DEADMAN_TICK_DISABLED, APP_BASE_URL, DEADMAN_TEST_MODE by name +
                                        #   purpose + location, no real secrets); Tests (server/client/e2e
                                        #   commands + DEADMAN_TICK_DISABLED=1 + merge gates)
```

**Structure Decision**: Keep the existing web-app layout (npm workspaces `client/`, `server/`, `shared/`).
This feature is a **client-only onboarding/help/polish layer plus documentation** — it adds **no** server
code, no contract change, and no shared constant. The new `OnboardingWizard`/`DeadmanHelp`/`EmptyState`
components and the `onboarding/` pure helpers live under `client/src/`; they **reuse** the existing
per-endpoint clients (`deadmanClient`, `contactClient`, `noteClient`, `releaseClient.testRelease`) and the
existing `NoteEditor`/`ContactList`/`DeadmanDashboard` components rather than re-implementing them. First-run
detection (`onboarding/firstRun.ts`) is a pure function over existing reads; wizard step/dismissal state is
client-local (`sessionStorage`), never persisted to the backend. The accessibility pass and the empty-state
+ countdown polish are corrective/presentation edits over the existing dead-man surfaces (008–011) plus the
new components, all to the constitution IV baseline. Because this feature **changes how the app is
documented operationally** — the whole suite's architecture, run/codegen + `deadman:tick`, the new env vars,
and the test commands — **all four README sections** and `server/.env.example` are updated in the same
commit as the relevant change (per CLAUDE.md README policy); no real secret values are written.

## Complexity Tracking

> No constitution violations — this section intentionally left empty. (This feature adds **no** backend
> endpoint, table, column, env var, or external service; first-run is derived from existing reads and wizard
> state is client-local session storage — no new persistence; the wizard, help, and test-release CTA reuse
> the existing endpoints, clients, and `NoteEditor`/`ContactList`/`DeadmanDashboard` components; the polish
> is presentation-only and adds no UI library; the contract/`shared/src/api.ts` are unchanged. The only
> "new" surface is accessible client UI + the four-section README/`.env.example` documentation — the
> constitution's accessibility-by-default and README-as-truth obligations themselves.)
