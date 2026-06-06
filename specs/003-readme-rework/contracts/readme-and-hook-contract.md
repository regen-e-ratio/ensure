# Contract: README structure + pre-commit hook

**Feature**: `003-readme-rework` | **Date**: 2026-06-06

This feature exposes two contracts: the **README's required structure** (the document a reader
consumes) and the **pre-commit hook's interface** (the tooling a contributor's `git commit`
invokes). Both are verifiable.

---

## Contract A — README structure

**Consumer**: a developer onboarding from a fresh clone.

**Guarantees**:

1. The README contains exactly these top-level sections, in this order, and no others:
   `Header` → `Architecture` → `Run` → `Manual Setup` → `Tests`.
   *(Section titles may be worded naturally, e.g. "## Architecture", "## Running locally",
   "## Manual setup", "## Tests" — but each must map 1:1 to one of these.)*
2. **Architecture** describes: the workspaces and their responsibilities; the request + auth/session
   flow; the data store and its tables; and **every** external service (currently: Google OAuth).
3. **Run** lists exact, ordered commands that take a fresh clone to a running app, including
   dependency install, `npm run gen:api`, the two dev servers, and the resulting URLs/ports.
4. **Manual Setup** enumerates every required env var/secret (by name + purpose + destination) and
   every external resource (the Google OAuth client, incl. redirect URI), with how to obtain each.
5. **Tests** lists the commands for unit/integration/contract tests, type-check, lint, and e2e —
   including environment-specific variants — plus the merge quality gates.

**Prohibitions**:
- No section outside the five above (no roadmap, history, scope tables, vision, redundant API
  table). — FR-007
- No literal secret values, tokens, or credentials. — FR-005
- No *required* outbound link (self-contained). — FR-012

**Acceptance check** (maps to SC-001..SC-003, SC-005):
- [ ] Every heading maps to one of the five sections (no extras).
- [ ] A newcomer following only the README reaches a running app and a passing `npm test`.
- [ ] All required env vars / secrets / the Google client appear in Manual Setup; none expose a value.
- [ ] Result is leaner in non-essential content than the prior README, with no loss of essential
      operational info.

---

## Contract B — pre-commit hook

**Invoker**: `git commit` (via `core.hooksPath=.githooks`).

**Input**: the staged change set, obtained as `git diff --cached --name-only`.

**Behavior** (pure classification → side effect):

| Condition | stdout | exit code |
|-----------|--------|-----------|
| Staged paths intersect the relevance globs **and** `README.md` is **not** staged | Warning naming the triggering path(s) and the four README areas, plus how to proceed (update README, or `--no-verify`) | `1` (soft block) |
| Staged paths intersect the relevance globs **and** `README.md` **is** staged | (nothing, or a one-line confirmation) | `0` |
| Staged paths do **not** intersect the relevance globs | (nothing) | `0` |

**Relevance globs** (initial): `server/src/**`, `client/src/**`, `shared/src/**`, `contracts/**`,
`e2e/**`, `playwright.config.ts`, `eslint.config.js`, `tsconfig*.json`, `package.json`,
`*/package.json`, `**/.env.example`.

**Override**: `git commit --no-verify` always bypasses the hook (author is the final arbiter of
relevance). — spec Assumptions

**Non-functional**:
- Completes in <1s; reads only the staged name list (no diff content parsing). — plan Performance
- Dependency-free POSIX `sh`; no network; never writes files.
- `npm install`'s `prepare` step sets `core.hooksPath .githooks` best-effort (never fails install
  outside a git checkout).

**Acceptance check** (maps to SC-007 + the unit test, research D6):
- [ ] Classifier unit test passes for a table of staged-path cases:
      `server/src/auth/routes.ts` → block; `package.json` → block; `README.md` (+ a relevant file)
      → pass; `specs/003-readme-rework/plan.md` only → pass; `client/src/styles.css` → block.
- [ ] Manual: commit a change to `server/src/**` without touching README → hook warns + blocks.
- [ ] Manual: commit a change to only `specs/**` → hook stays silent, commit proceeds.
- [ ] `git commit --no-verify` proceeds regardless.
