<!--
Sync Impact Report
==================
Version change: [unversioned template] → 1.0.0
Bump rationale: Initial ratification — first concrete constitution replacing the template
  placeholders. Establishes five governing principles and supporting sections.

Modified principles (placeholder → concrete):
  [PRINCIPLE_1_NAME] → I. Test-Driven Development (NON-NEGOTIABLE)
  [PRINCIPLE_2_NAME] → II. Keep It Simple
  [PRINCIPLE_3_NAME] → III. Typed End to End
  [PRINCIPLE_4_NAME] → IV. Accessible by Default
  [PRINCIPLE_5_NAME] → V. Small Pull Requests

Added sections:
  - Technology Constraints (was [SECTION_2_NAME])
  - Development Workflow & Quality Gates (was [SECTION_3_NAME])

Removed sections: none

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — Constitution Check gates align with principles
  ✅ .specify/templates/spec-template.md — reviewed; no mandatory section changes needed
  ✅ .specify/templates/tasks-template.md — UPDATED: tests changed from OPTIONAL to MANDATORY
     to align with Principle I (TDD, NON-NEGOTIABLE)
  ✅ .specify/templates/checklist-template.md — reviewed; generic, no changes needed

Follow-up TODOs:
  - RATIFICATION_DATE set to 2026-06-02 (today). If the project adopted these principles
    on an earlier date, amend RATIFICATION_DATE accordingly.
-->

# Ensure Constitution

## Core Principles

### I. Test-Driven Development (NON-NEGOTIABLE)
Every feature MUST ship with automated tests, written before or alongside the implementation
code — never bolted on after the fact. A pull request that adds or changes behavior without
corresponding tests MUST NOT merge. Tests MUST be runnable in CI and MUST pass before merge.

**Rationale**: Tests written with (or before) the code capture intended behavior while it is
fresh, prevent regressions, and document the contract. Deferring tests reliably means they are
never written.

### II. Keep It Simple
Prefer the smallest design that fully satisfies the current spec. Speculative abstraction,
configuration, and indirection introduced for hypothetical future needs are PROHIBITED (YAGNI).
Any added complexity — a new layer, dependency, or pattern — MUST be justified by a concrete
present requirement.

**Rationale**: For a small app, simplicity is the dominant cost driver. Premature abstraction is
harder to remove than to add later, and it slows every future reader of the code.

### III. Typed End to End
TypeScript MUST be used on both client and server. Public function signatures, API request and
response shapes, and module boundaries MUST be explicitly typed. Use of `any` (implicit or
explicit) and unchecked type assertions MUST be avoided; where genuinely unavoidable, they MUST
be justified with a comment. Type checking MUST pass in CI.

**Rationale**: Shared types across the stack catch integration errors at compile time, make
refactoring safe, and serve as living documentation of the client/server contract.

### IV. Accessible by Default
User-facing features MUST be keyboard-navigable, MUST use semantic HTML, and MUST meet WCAG AA
contrast ratios. Accessibility is a baseline acceptance criterion for UI work, not an optional
enhancement. Interactive elements MUST expose appropriate roles, labels, and focus states.

**Rationale**: Accessibility is far cheaper to build in from the start than to retrofit, and it
is a correctness property of the UI — an inaccessible feature is an incomplete feature.

### V. Small Pull Requests
Each pull request MUST address exactly one feature or one fix. Unrelated changes MUST be split
into separate PRs. PRs SHOULD be reviewable in a single sitting; large changes MUST be decomposed
into incremental, independently mergeable steps.

**Rationale**: Small, focused PRs are reviewed faster and more thoroughly, isolate risk, simplify
reverts, and produce a clean, bisectable history.

## Technology Constraints

- **Language**: TypeScript on both client and server (see Principle III). No untyped JavaScript
  in application source.
- **Scope**: This is a small full-stack web application. Architecture decisions MUST favor the
  simplest option that meets the spec (see Principle II).
- **Testing**: An automated test runner MUST be configured and wired into CI. Every feature
  contributes tests (see Principle I).
- **Accessibility**: Semantic HTML and WCAG AA contrast are minimum standards for all UI
  (see Principle IV).

## Development Workflow & Quality Gates

- **Branching**: Work happens on feature branches; one feature or fix per branch and per PR
  (see Principle V).
- **Merge gates**: A PR MUST NOT merge unless (1) tests pass, (2) type checking passes, and
  (3) UI changes meet the accessibility baseline.
- **Review**: Every PR requires review. Reviewers MUST verify compliance with these principles
  and flag any unjustified complexity.
- **Justification**: Deviations from a principle MUST be documented in the PR description with an
  explicit rationale; unexplained deviations are grounds to block the merge.

## Governance

This constitution supersedes other development practices where they conflict. All PRs and reviews
MUST verify compliance with the principles above.

Amendments MUST be proposed via pull request, documented with a rationale, and approved before
taking effect. Versioning of this document follows semantic versioning:
- **MAJOR**: Backward-incompatible governance changes — removing or redefining a principle.
- **MINOR**: Adding a new principle or section, or materially expanding guidance.
- **PATCH**: Clarifications, wording, and non-semantic refinements.

Complexity MUST be justified against Principle II. When in doubt, choose the simpler option and
revisit only when a concrete need arises.

**Version**: 1.0.0 | **Ratified**: 2026-06-02 | **Last Amended**: 2026-06-02
