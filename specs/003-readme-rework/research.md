# Phase 0 Research: Lean, Self-Maintaining README

**Feature**: `003-readme-rework` | **Date**: 2026-06-06

This feature had no `NEEDS CLARIFICATION` markers in Technical Context (the two open decisions were
resolved in `/speckit-clarify`). The research below records the remaining design decisions needed to
execute the rework with no new dependencies and minimal complexity.

---

## D1 — Source of truth for the README's architecture content

**Decision**: Synthesize the architecture section from the *actual current code* plus the merged
specs. Concretely, the README architecture reflects what is in the repo today:

- **Workspaces**: `shared/` (contract-derived API types), `server/` (Express 5 API), `client/`
  (React 18 + Vite SPA), `e2e/` (Playwright), `contracts/openapi.yaml` (source of truth for types).
- **Server wiring** (`server/src/app.ts`): `express.json()` → `cookie-parser` → `/api/auth` router
  → `requireAuth` middleware gating `/api/note` → env-gated test seams (`/api/test/reset`,
  `/api/test/login`).
- **Auth model** (`server/src/auth/*`, spec `002` plan): server-side OAuth 2.0 Authorization Code +
  PKCE with Google; server mints its own session = stateless ~1h access JWT (`jose`) + opaque hashed
  refresh token with 24h sliding inactivity; both as httpOnly/Secure/SameSite=Lax cookies; client
  silent-refresh on 401.
- **Data store**: better-sqlite3 with three tables — `note` (single row), `user`, `session`
  (`server/src/db/index.ts`).
- **External dependency**: exactly one — the **Google OAuth 2.0 Web client**.

**Rationale**: The README must be accurate to the present state (FR-011), and the code + the `002`
plan/quickstart already encode that state. No invention required.

**Alternatives considered**: Copy the `001` README's note-only description (rejected — stale, omits
auth); link to the spec plans instead of describing inline (rejected — violates FR-012
self-containment).

---

## D2 — Pre-commit hook delivery mechanism

**Decision**: Commit the hook as a tracked file at **`.githooks/pre-commit`** and activate it by
setting **`git config core.hooksPath .githooks`** from an npm **`prepare`** script in the root
`package.json` (runs automatically on `npm install`). The README documents a one-line manual
fallback (`git config core.hooksPath .githooks`) in case `prepare` did not run.

**Rationale**: Dependency-free and version-controlled. `prepare` runs on every `npm install`
(including for contributors), so activation is automatic without adding Husky or any package
(Constitution II / YAGNI). `core.hooksPath` lets the whole team share one tracked hooks directory.

**Alternatives considered**:
- **Husky** — rejected: adds a dependency and lifecycle machinery for a single ~30-line hook.
- **Writing directly into `.git/hooks/pre-commit`** — rejected: not version-controlled, every clone
  must hand-install, easy to drift.
- **A CI gate** — explicitly rejected by clarification Q1 (local enforcement, not CI).

**Edge note**: `prepare` should be best-effort (`git config ... || true`) so `npm install` outside a
git checkout (e.g., tarball/CI cache) never fails.

---

## D3 — "README-relevant" detection heuristic

**Decision**: The hook classifies a commit as README-relevant when the staged path set
(`git diff --cached --name-only`) intersects an **allowlist of relevance globs**, and `README.md`
itself is **not** staged. Relevant globs (the four content areas map to these):

- Architecture / run / tests behavior: `server/src/**`, `client/src/**`, `shared/src/**`,
  `contracts/**`, `e2e/**`, `playwright.config.ts`, `eslint.config.js`, `tsconfig*.json`.
- Run / setup surface: root `package.json`, `*/package.json` (scripts), `**/.env.example`.

When relevant-and-README-not-staged, the hook **prints a clear warning naming the triggering files
and the four areas, and asks the author to either update `README.md` or re-commit with `--no-verify`
to confirm it is genuinely unaffected.** Default behavior is **warn + non-zero exit (soft block)**
so it is impossible to *silently* skip, while `--no-verify` always lets a deliberate author proceed.

**Rationale**: A path allowlist is simple, fast, and transparent (no parsing of diffs). Soft-block +
`--no-verify` honors the spec assumption that the author is the final arbiter and that no genuinely
irrelevant change becomes un-committable, while still forcing a conscious decision.

**Alternatives considered**:
- Content/keyword diff analysis — rejected: complex, slow, false-positive prone (YAGNI).
- Hard block with no override — rejected: would make irrelevant changes un-committable (violates the
  spec assumption).
- Pure warning with exit 0 — rejected: too easy to ignore; the soft block forces an explicit choice.

**Tunable knobs deliberately excluded** (YAGNI): per-file relevance config UI, auto-detecting which
README section to edit. The glob list lives inline (or in one tiny tooling file) and is edited
directly.

---

## D4 — Disposition of removed bloat

**Decision**: **Delete** non-essential README content (project narrative, deadman-switch vision,
roadmap, scope in/out lists, the redundant API table, the standalone "tech stack" list once folded
into Architecture). Do **not** create a `docs/` tree to rehouse it.

**Rationale**: The deadman-switch vision and scope notes already live in `specs/001-store-notes/` and
`specs/002-google-sso-auth/`; re-housing would be bloat-by-relocation and dilute the
single-source-of-truth promise. The API surface belongs to `contracts/openapi.yaml` and is described
(not tabulated) in Architecture.

**Alternatives considered**: Move narrative to `docs/PROJECT.md` (rejected — adds a doc to maintain
for content already in specs); keep a trimmed scope blurb (rejected — not one of the four areas).

---

## D5 — `CLAUDE.md` rule placement and shape

**Decision**: Add a new top-level section (e.g., `## README maintenance`) to `CLAUDE.md` **outside**
and **after** the existing `<!-- SPECKIT START --> … <!-- SPECKIT END -->` managed block, so the
Spec Kit agent-context updater never overwrites it. The rule states: the README's four allowed areas
+ header; the update-only-if-relevant test (update iff a change affects architecture/run/setup/
tests, otherwise leave untouched); the no-bloat / no-secrets constraints; and a pointer to the
`.githooks/pre-commit` safety net.

**Rationale**: The managed block is rewritten by `speckit.agent-context.update`; placing our durable
rule outside it guarantees persistence. A concise, imperative rule is directly actionable by future
human or AI contributors (FR-010, SC-006).

**Alternatives considered**: Editing inside the SPECKIT markers (rejected — would be clobbered on the
next agent-context refresh); a separate `CONTRIBUTING.md` (rejected — the user explicitly chose
`CLAUDE.md`, and it is what AI agents read).

---

## D6 — Testing the hook without app-source coupling

**Decision**: Factor the relevance decision into a **pure, testable unit**: a function/script that
takes a list of staged paths and returns relevant/not + the matched triggers. Test it with a small
table of cases (e.g., `server/src/auth/routes.ts` → relevant; `README.md` staged → not flagged;
`specs/**` only → not relevant; `package.json` → relevant). Wire the test into `npm test` while
keeping the helper and test **out of** the `client|server|shared` workspaces (it is repo tooling).

**Rationale**: Satisfies Constitution I (the one behavior is tested) without polluting app source or
its type surface (Constitution III note). A table-driven test pins the heuristic so future glob
edits are deliberate.

**Alternatives considered**: No test, manual-only (rejected — the hook *is* behavior, TDD is
non-negotiable); testing by spawning real git commits (rejected — slower, flakier than testing the
pure classifier).

---

## Summary of decisions

| ID | Decision |
|----|----------|
| D1 | README architecture synthesized from current code + `001`/`002` specs (workspaces, server wiring, OAuth+session model, SQLite tables, single Google external dep) |
| D2 | Tracked `.githooks/pre-commit` activated via `core.hooksPath` from an npm `prepare` step; no Husky |
| D3 | Relevance = staged paths intersect an allowlist of globs **and** README not staged → soft-block warning, `--no-verify` overrides |
| D4 | Delete removed bloat (no `docs/` rehoming); narrative already in `specs/**` |
| D5 | Durable rule in `CLAUDE.md` **outside** the SPECKIT managed block |
| D6 | Extract relevance logic as a pure, table-tested tooling unit wired into `npm test` |

All decisions favor zero new dependencies and the smallest change that satisfies the spec.
