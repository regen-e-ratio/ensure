# Feature Specification: Lean, Self-Maintaining README

**Feature Branch**: `003-readme-rework`

**Created**: 2026-06-06

**Status**: Draft

**Input**: User description: "Let's rework the README.md. The file currently is bloated. I only want the most important information and it needs to be updated every time something changes and it is relevant. What I find relevant for the readme is: the full architecture description (in detail!!), how to run the application, all the manual things that need to be done in order to run the application (for example, creating secrets, populating env vars, creating external things like the Google client) and finally how to run tests. It is important that when something gets added, the README is updated, IF NECESSARY! If a commit doesn't change anything important the README should stay; but if a commit introduces a new external service, it should be described how to configure it. Maybe use the CLAUDE.md file to ensure future commits will update the readme and keep it clean. We can't have bloat on the readme."

## Clarifications

### Session 2026-06-06

- Q: How should the "update the README when relevant" rule be enforced? → A: A local **git pre-commit hook** that flags/blocks when changes touch README-relevant paths (architecture, run, setup, tests) without a corresponding README change, **in addition to** the durable rule in `CLAUDE.md` and review discipline. (Not a CI gate.)
- Q: Must a reader run + test the app using only the README, or may it link out to `specs/**/quickstart.md`? → A: The README is **fully self-contained** — all four areas are complete in the README itself; no outbound link is required to get the app running or tested.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Onboard from a single, accurate README (Priority: P1)

A developer who has never seen the project clones the repository, opens `README.md`, and finds
exactly four things, in detail and nothing else: (1) a full description of the system architecture,
(2) how to run the application, (3) every manual step required before it will run — creating
secrets, populating environment variables, and provisioning external dependencies such as the
Google OAuth client, and (4) how to run the tests. Following only the README, they get the app
running locally and the test suite passing without consulting any other document or asking a
teammate.

**Why this priority**: This is the core deliverable. A README that lets a newcomer go from clone to
running-and-tested is the entire point of the rework; if only this story ships, the feature already
delivers its value.

**Independent Test**: Hand the repository and the README to someone with no prior knowledge of the
project (or a fresh environment) and have them follow only the README. Success = the app runs and
the documented test commands pass, with no missing manual step and no need to open other docs.

**Acceptance Scenarios**:

1. **Given** a fresh clone, **When** a developer reads only the README's architecture section,
   **Then** they can describe how the client, server, shared types, data store, authentication, and
   external services fit together, including the request/auth flow.
2. **Given** a fresh clone, **When** a developer follows the README's setup and run steps in order,
   **Then** the application starts locally with no undocumented prerequisite.
3. **Given** the application requires secrets, env vars, and an external Google OAuth client,
   **When** the developer follows the README's manual-setup section, **Then** each required value
   and external resource is enumerated with how to obtain or create it and where to put it.
4. **Given** the application is running, **When** the developer runs the documented test commands,
   **Then** the tests execute and the README's stated quality gates can be verified.

---

### User Story 2 - Trust the README to be current (Priority: P2)

Because the README is the single source of operational truth, a reader must be able to trust that
it reflects the current state of the system. When the codebase changes in a way that affects
architecture, how to run the app, required manual setup, external services, or how to run tests, the
README is updated in the same change. When a change does not affect any of those things, the README
is deliberately left untouched.

**Why this priority**: A lean README that silently drifts out of date is worse than a bloated one,
because readers stop trusting it. Keeping it current is what makes Story 1 durable rather than a
one-time cleanup.

**Independent Test**: Review recent representative changes — one that adds an external service or env
var, and one that is a pure internal refactor — and confirm the README was updated for the former
and correctly left unchanged for the latter.

**Acceptance Scenarios**:

1. **Given** a change that introduces a new external service, secret, or environment variable,
   **When** the change is prepared, **Then** the README's manual-setup section is updated to describe
   how to configure it.
2. **Given** a change that alters the architecture or the run/test commands, **When** the change is
   prepared, **Then** the corresponding README section is updated to match.
3. **Given** a change that touches only internal implementation with no effect on architecture, run,
   setup, or tests, **When** the change is prepared, **Then** the README is left unchanged (no
   churn).

---

### User Story 3 - A standing rule keeps the README lean over time (Priority: P3)

The project's contributor guidance (the `CLAUDE.md` agent-context file) carries an explicit,
durable rule defining the README's fixed scope, the "update only if relevant" discipline, and the
no-bloat constraint, so that every future contributor — human or AI agent — applies the same
standard without having to rediscover it.

**Why this priority**: This makes the discipline in Story 2 self-sustaining. It is lower priority
because the README rework delivers value immediately even before the rule is codified, but without
it the README will slowly re-bloat.

**Independent Test**: Open `CLAUDE.md` and confirm it states the README's allowed sections, the
relevance test for when to update it, and the instruction to keep it free of bloat — clearly enough
that a contributor could apply it unambiguously.

**Acceptance Scenarios**:

1. **Given** `CLAUDE.md`, **When** a contributor reads it before making a change, **Then** they find
   the rule that the README is limited to architecture, run, manual setup, and tests.
2. **Given** `CLAUDE.md`, **When** a contributor finishes a change, **Then** the guidance tells them
   to update the README if and only if the change affected one of those areas, and to avoid adding
   non-essential content.

---

### Edge Cases

- **Information that doesn't fit the four sections** (e.g., project history, roadmap, the future
  deadman-switch vision, contribution etiquette): it is removed from the README, or relocated to a
  more appropriate document, rather than retained.
- **A required manual step is environment-specific** (e.g., a fallback for running browser tests
  where the bundled browser is unavailable): the README documents the variation as part of the
  relevant section rather than omitting it.
- **A change is ambiguous about relevance** (could be read as internal-only or as affecting setup):
  the discipline must resolve the ambiguity in favor of keeping the README accurate — when in doubt
  about whether running the app or its setup changed, the README is checked and updated if affected.
- **A secret or credential value itself**: never written into the README; only the name of the
  variable, what it is for, and how/where to provide it are documented.
- **External-service setup changes upstream** (e.g., the OAuth provider's console UI): the README
  describes the required end state (redirect URIs, scopes, which credentials to copy) at a level
  that survives minor UI churn.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The README MUST be limited to exactly four content areas — (a) full architecture
  description, (b) how to run the application, (c) all manual setup required to run it, and (d) how
  to run the tests — plus a minimal identifying header (project name and one-line purpose).
- **FR-002**: The architecture section MUST describe the system in detail: its components and their
  responsibilities, how they interact, the data store, the authentication/session model, and every
  external service the system depends on.
- **FR-003**: The run section MUST give the exact, ordered commands to start the application locally,
  including any build/codegen steps and the resulting URLs/ports.
- **FR-004**: The manual-setup section MUST enumerate every prerequisite that cannot be derived from
  running an install command, including each required environment variable and secret (by name and
  purpose) and each external resource that must be provisioned (e.g., the Google OAuth client), with
  instructions for obtaining or creating it and where its values must be placed.
- **FR-005**: The README MUST NOT contain actual secret values, credentials, or tokens — only their
  names, purposes, and how to supply them.
- **FR-006**: The tests section MUST give the commands to run each category of test and state the
  quality gates a change must satisfy, including any environment-specific variation needed to run
  them.
- **FR-007**: The README MUST exclude content outside the four areas (e.g., roadmap, history,
  speculative future features, scope-in/scope-out lists, redundant API tables) so that it stays lean;
  such content MUST be removed or relocated, not retained.
- **FR-008**: When a change affects any of the four content areas, that change MUST update the README
  in the same change set so the README never lags the code.
- **FR-009**: When a change does NOT affect any of the four content areas, the README MUST be left
  unchanged (no unnecessary edits or additions).
- **FR-010**: The relevance rule — what the README may contain, when to update it, when to leave it
  alone, and the no-bloat constraint — MUST be recorded as durable contributor guidance in
  `CLAUDE.md` so future contributors apply it consistently.
- **FR-011**: The README's content MUST accurately reflect the current state of the system at the
  time of the rework, including the authentication feature and its external Google dependency, not
  only the original note-storage slice.
- **FR-012**: The README MUST be fully self-contained: a reader MUST be able to understand the
  architecture, run the application, complete all manual setup, and run the tests using only the
  README, without following any outbound link to another document. References to other documents
  (e.g., `specs/**/quickstart.md`) are permitted only as optional further reading, never as a
  required step.
- **FR-013**: A local **git pre-commit hook** MUST be provided that detects when staged changes
  touch README-relevant areas (architecture, run, manual setup, or tests) without a corresponding
  change to `README.md`, and prompts/blocks the commit so the author can update the README or
  confirm it is unaffected. Enforcement is local (pre-commit), not a CI gate.

### Key Entities *(include if feature involves data)*

- **README.md**: The single, lean, authoritative operational document. Attributes: a fixed,
  bounded set of sections (header, architecture, run, manual setup, tests); always current; no
  bloat.
- **CLAUDE.md guidance entry**: The durable rule that governs the README's scope and its
  update-only-if-relevant maintenance discipline. Relationship: constrains every future change to
  README.md.
- **Manual-setup item**: A prerequisite a reader must satisfy by hand — an environment variable, a
  secret, or an externally provisioned resource (e.g., the Google OAuth client) — described by name,
  purpose, and how/where to provide it, never by value.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer new to the project can go from a fresh clone to a running application and a
  passing test run using only the README, with zero undocumented manual steps.
- **SC-002**: The README contains only the four designated content areas plus the identifying header;
  a reviewer can confirm 100% of its sections map to one of those areas.
- **SC-003**: 100% of the application's required environment variables, secrets, and external
  services (including the Google OAuth client) are documented in the manual-setup section, with none
  missing and no secret values exposed.
- **SC-004**: For a representative set of recent changes, the README was updated for every change
  that affected architecture/run/setup/tests and left unchanged for every change that did not —
  demonstrating the relevance discipline holds in both directions.
- **SC-005**: The reworked README is meaningfully leaner than the prior version in non-essential
  content while being more complete on the four essential areas (no loss of required operational
  information).
- **SC-006**: A contributor reading `CLAUDE.md` can correctly state, without seeing this spec, what
  the README is allowed to contain and the rule for when to update it.
- **SC-007**: Committing a change that touches a README-relevant area without updating `README.md`
  triggers the pre-commit hook's prompt/block, while a purely internal change that touches no
  README-relevant area commits without interruption.

## Assumptions

- The four content areas named by the user (architecture, run, manual setup, tests) plus a minimal
  identifying header are the complete and intended scope of the README; anything else is bloat.
- "Full architecture description (in detail)" means enough depth for a developer to understand
  component responsibilities, interactions, the data model, and the auth/session flow — not a
  line-by-line code walkthrough.
- The current system state to document is the note app **with** Google SSO authentication (feature
  `002-google-sso-auth`), including its external Google OAuth dependency, since that is the latest
  merged/planned state.
- `CLAUDE.md` is the correct home for the durable maintenance rule, as the user suggested; its
  existing managed Spec Kit section is preserved and the new guidance is additive.
- Enforcement of "update the README when relevant" is achieved through three complementary means:
  the durable rule in `CLAUDE.md`, review discipline, and a **local git pre-commit hook** (FR-013).
  A CI gate is explicitly out of scope for this feature.
- The README is fully self-contained (FR-012). The existing `specs/**/quickstart.md` may remain as
  optional deeper-dive reading, but the README must not depend on it; any manual step required to
  run or test the app lives in the README itself.
- The pre-commit hook's "README-relevant" detection is heuristic (e.g., path/keyword based) and may
  prompt rather than hard-block, so it never makes a genuinely irrelevant change un-committable; the
  author remains the final arbiter of relevance per the `CLAUDE.md` rule.

## Dependencies

- Reflects the merged/landed state of features `001-store-notes` and `002-google-sso-auth`; the
  architecture and manual-setup sections depend on the auth feature's external Google OAuth client
  and its environment variables/secrets.
