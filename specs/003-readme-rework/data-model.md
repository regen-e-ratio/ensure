# Phase 1 Data Model: Lean, Self-Maintaining README

**Feature**: `003-readme-rework` | **Date**: 2026-06-06

This feature has no runtime database. The "entities" are the documentation/tooling artifacts the
rework produces and the structures that govern them. Modeling them keeps the rework verifiable.

---

## Entity 1 — README document

The single authoritative operational document. Its "schema" is a fixed, ordered, bounded set of
sections; anything outside this schema is bloat (FR-001, FR-007).

| Section (in order) | Required | Content | Source FR |
|--------------------|----------|---------|-----------|
| Header | Yes | Project name + one-line purpose. No badges/narrative. | FR-001 |
| Architecture | Yes | Components & responsibilities, interactions, data store, auth/session model, **every** external service. In detail. | FR-002 |
| Run | Yes | Exact ordered commands to start locally, incl. install + `gen:api` codegen + resulting URLs/ports. | FR-003 |
| Manual Setup | Yes | Every prerequisite not produced by install: each env var/secret (name + purpose + where), each external resource (Google OAuth client) with how to create it. **No secret values.** | FR-004, FR-005 |
| Tests | Yes | Commands per test category + quality gates + env-specific variations (e.g., `PW_CHANNEL=chrome`, `AUTH_TEST_MODE=1`). | FR-006 |

**Invariants**:
- Every top-level section maps to exactly one row above (SC-002).
- Self-contained: no outbound link is a *required* step (FR-012); links are optional further reading
  only.
- Contains zero secret values (FR-005).
- Accurate to current system state incl. auth + Google dependency (FR-011).

**Validation**: A reviewer can enumerate the README's headings and confirm 1:1 mapping to the table;
a newcomer can run + test using only the README (SC-001).

---

## Entity 2 — Manual-setup item

One prerequisite a reader satisfies by hand. Enumerated in the Manual Setup section.

| Field | Description |
|-------|-------------|
| `name` | The variable/resource identifier (e.g., `GOOGLE_CLIENT_ID`). |
| `kind` | `env-var` \| `secret` \| `external-resource`. |
| `purpose` | What it is for, in one phrase. |
| `how_to_obtain` | Where/how to create or get it (e.g., Google Cloud Console steps; `node -e` to generate the JWT secret). |
| `where_it_goes` | Destination (e.g., `server/.env`, matched against `server/.env.example`). |
| `required` | Whether the app refuses to boot without it. |

**Current instances** (from `server/.env.example` + `server/src/config/env.ts`):

| name | kind | required | where |
|------|------|----------|-------|
| `GOOGLE_CLIENT_ID` | external-resource credential | Yes | `server/.env` |
| `GOOGLE_CLIENT_SECRET` | secret | Yes | `server/.env` |
| `GOOGLE_REDIRECT_URI` | env-var | Yes (must match Google client) | `server/.env` |
| `AUTH_JWT_SECRET` | secret | Yes (≥16 chars) | `server/.env` |
| `AUTH_TEST_MODE` | env-var | No (tests only) | server env |
| `NOTE_ALLOW_TEST_RESET` | env-var | No (tests only) | server env |
| **Google OAuth 2.0 Web client** | external-resource | Yes | Google Cloud Console (redirect URI `http://localhost:3000/api/auth/google/callback`) |

**Invariant**: 100% of required items are documented; none expose their value (SC-003, FR-005).

---

## Entity 3 — CLAUDE.md maintenance rule

The durable governance entry (FR-010). One additive section placed **outside** the
`<!-- SPECKIT START/END -->` managed block.

| Field | Content |
|-------|---------|
| Allowed scope | The four README sections + header (references Entity 1). |
| Update trigger | Update README **iff** a change affects architecture / run / manual setup / tests. |
| Leave-alone rule | If a change affects none of those, the README is left unchanged (no churn). |
| No-bloat constraint | Nothing outside the four areas; no secret values. |
| Safety net pointer | Mentions the `.githooks/pre-commit` reminder. |

**Invariant**: Persists across Spec Kit agent-context refreshes (outside the managed block).
**Validation**: SC-006 — a reader can restate scope + update rule without seeing the spec.

---

## Entity 4 — Pre-commit hook relevance map

The configuration that drives the hook's classification (FR-013, research D3).

| Field | Description |
|-------|-------------|
| `relevance_globs` | Ordered list of path globs that mark a staged change as README-relevant. |
| `readme_path` | `README.md` — when staged, suppresses the warning. |
| `decision` | `relevant` iff `staged ∩ relevance_globs ≠ ∅` **and** `README.md ∉ staged`. |
| `action` | On `relevant`: print warning naming triggers + the four areas; exit non-zero (soft block). |
| `override` | `git commit --no-verify` bypasses (author is final arbiter). |

**`relevance_globs` (initial set)**:
`server/src/**`, `client/src/**`, `shared/src/**`, `contracts/**`, `e2e/**`,
`playwright.config.ts`, `eslint.config.js`, `tsconfig*.json`, `package.json`, `*/package.json`,
`**/.env.example`.

**State transitions** (per commit):

```text
staged paths ──▶ intersect relevance_globs?
                   │no              │yes
                   ▼                ▼
              exit 0           README.md staged?
              (silent)          │yes        │no
                                ▼           ▼
                            exit 0      print warning + exit 1 (soft block)
                            (silent)    → author updates README or uses --no-verify
```

**Invariant** (SC-007): a README-relevant commit without a README change triggers the warning; a
purely internal/irrelevant commit (e.g., only `specs/**` or a comment-only change to a non-listed
path) passes silently. The classifier is a pure function of the staged path set (research D6), making
it unit-testable in isolation.
