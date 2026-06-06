# Implementation Plan: Lean, Self-Maintaining README

**Branch**: `003-readme-rework` | **Date**: 2026-06-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-readme-rework/spec.md`

## Summary

Replace the current bloated `README.md` with a **lean, fully self-contained** document bounded to
exactly four content areas — **(1) full architecture (in detail), (2) how to run, (3) all manual
setup (secrets, env vars, the external Google OAuth client), and (4) how to run tests** — plus a
minimal identifying header. The README must reflect the system's *current* state (notes app **with**
Google SSO, feature `002`), and a reader must be able to go clone → run → tests-pass using only the
README (FR-012).

To keep it lean over time, the rework adds two enforcement layers: a durable **rule in `CLAUDE.md`**
defining the README's fixed scope and the "update only if relevant" discipline (FR-010), and a
**local git pre-commit hook** that warns when staged changes touch README-relevant areas without a
corresponding `README.md` change (FR-013). The hook is dependency-free (POSIX `sh` under a tracked
`.githooks/` directory, wired via `core.hooksPath` from an npm `prepare` step), heuristic, and
bypassable with `--no-verify` — so the author stays the final arbiter of relevance and no genuinely
irrelevant change is ever blocked.

This is a **documentation + repo-tooling** feature: it adds no application runtime code. The only
executable artifact is the pre-commit hook plus a small script that powers it.

## Technical Context

**Language/Version**: Markdown (`README.md`, `CLAUDE.md`); POSIX `sh` for the git hook (repo
`init-options.json` sets `"script": "sh"`). No application TypeScript is added. Repo baseline
remains TypeScript 5.6 on Node.js 22 LTS.

**Primary Dependencies**: **None new.** The hook uses only `git` + POSIX `sh`. `core.hooksPath` is
set by an npm `prepare` script (runs automatically on `npm install`) — no Husky or other tooling
dependency (Constitution II / YAGNI).

**Storage**: N/A — files in the repo (`README.md`, `CLAUDE.md`, `.githooks/pre-commit`, a tiny
relevance-config if extracted).

**Testing**: A unit test for the hook's **relevance-detection logic** (the only behavior this
feature introduces): given a set of staged paths, does it correctly classify "README-relevant" vs.
"not relevant"? Plus manual onboarding verification of the README (SC-001) and a manual two-case
check of the hook (SC-007: relevant-without-README → prompts; internal-only → silent). The README
and CLAUDE.md edits are prose and need no automated test.

**Target Platform**: Developer workstations running `git` (hook); the repository (docs).

**Project Type**: Documentation + repository tooling. No client/server/runtime change.

**Performance Goals**: The pre-commit hook MUST complete in well under 1s on a normal commit so it
never becomes friction (it inspects only `git diff --cached --name-only`).

**Constraints**: README fully self-contained (FR-012); **no secret values** in the README (FR-005);
strictly the four content areas + header (FR-001/FR-007); hook is non-blocking/bypassable and
heuristic (spec Assumptions); CLAUDE.md change is additive and preserves the existing
`<!-- SPECKIT START/END -->` managed block.

**Scale/Scope**: One `README.md`, one additive `CLAUDE.md` section, one `.githooks/pre-commit`
script (+ optional helper + one `prepare` line in root `package.json`), one hook unit test.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|-----------|--------|----------------------------|
| I | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | The only executable behavior — the hook's relevance-detection — gets a unit test written with it (pure function: staged paths → relevant?). Prose artifacts (README, CLAUDE.md) carry no behavior and need no test; their acceptance is the manual SC-001 onboarding check. No behavior ships untested. |
| II | Keep It Simple | ✅ PASS | Zero new dependencies. Hook is a short POSIX `sh` script with a path/keyword allowlist; `core.hooksPath` via an npm `prepare` line beats adding Husky. Bloat is **deleted**, not relocated into a new `docs/` tree. No speculative config. |
| III | Typed End to End | ✅ PASS (with note) | No application source is added, so there is no untyped app code. The git hook is **repo tooling**, not application source — the constitution's "no untyped JS in application source" rule does not extend to a git hook; POSIX `sh` is the simplest correct tool and is justified here. If the relevance logic is extracted for testing, it is kept as a tiny shell/Node tooling script outside `client|server|shared/src`. |
| IV | Accessible by Default | ✅ N/A | No user-facing UI is added or changed. (README readability is addressed by the leanness/structure requirements, not WCAG.) |
| V | Small Pull Requests | ✅ PASS | One cohesive feature on its own branch (`003-readme-rework`): README rewrite + CLAUDE.md rule + pre-commit hook. Naturally sliceable (docs first, hook second) and reviewable in a sitting. |

**Merge gates** (constitution Development Workflow): `npm test` (incl. the new hook test) and
`npm run typecheck` pass; no UI → accessibility gate N/A.

**Result**: PASS. No violations requiring justification → Complexity Tracking left empty.

**Post-design re-check (after Phase 1)**: Still PASS. The Phase 1 design adds only Markdown, a
single tracked shell hook, one `prepare` line, and one tooling unit test — no new dependency, no
abstraction, no app-source type surface. All principles remain satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/003-readme-rework/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification (with Clarifications)
├── research.md          # Phase 0 output — decisions D1–D6
├── data-model.md        # Phase 1 output — README section schema, CLAUDE.md rule, hook relevance map
├── quickstart.md        # Phase 1 output — how to perform & verify the rework
├── contracts/
│   └── readme-and-hook-contract.md   # Phase 1 — README section contract + pre-commit hook contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root) — additions/changes to the existing layout

```text
README.md                          # REWRITTEN — header + Architecture + Run + Manual Setup + Tests only
CLAUDE.md                          # ADD an additive "README maintenance" rule section
                                   #   (OUTSIDE the existing <!-- SPECKIT START/END --> managed block)
package.json                       # ADD "prepare": "git config core.hooksPath .githooks" (best-effort)

.githooks/
└── pre-commit                     # NEW — POSIX sh: warn when README-relevant staged paths change
                                   #   without README.md staged; bypassable via --no-verify

scripts/                           # NEW (only if relevance logic is extracted for testing)
└── readme-relevance.*             # tiny pure helper: staged paths -> relevant? (sh or node tooling)

tests/ or scripts/__tests__/       # NEW — unit test for the relevance-detection logic
                                   #   (wired so `npm test` runs it; kept out of app workspaces)

server/.env.example                # UNCHANGED — already the source of truth the README points at
```

**Structure Decision**: Keep the existing npm-workspaces layout (`client/`, `server/`, `shared/`,
`e2e/`) untouched — this feature changes no application code. New artifacts are repository-level:
the rewritten `README.md`, an additive `CLAUDE.md` rule, and a tracked `.githooks/pre-commit`
activated via `core.hooksPath`. Removed README bloat is **deleted** (project history/scope already
live under `specs/001-*` and `specs/002-*`); no new `docs/` tree is introduced, keeping the
single-source-of-truth promise and avoiding bloat-by-relocation.

## Complexity Tracking

> No constitution violations — this section intentionally left empty. (No new dependencies, no
> abstraction, no app-source type surface; the POSIX-`sh` hook is the simplest correct tool for a
> git hook and is justified under Principle II.)
