# Implementation Plan: Per-User Note Ownership & Encryption at Rest

**Branch**: `004-note-ownership-encryption` | **Date**: 2026-06-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-note-ownership-encryption/spec.md`

## Summary

Turn the single **shared** note into a **per-user** note and make its content **encrypted at rest**,
with a key scheme built for **rotation**. The existing singleton `note` table (`id = 1`) is replaced
by a table **keyed by `user_id`** (one note per owner — clarified), storing **ciphertext** plus the
**key version** that protects it. Reads and writes are scoped to `req.user.id` (already provided by
the `requireAuth` middleware from 002), so addressing another user's note is **structurally
impossible** — there is no endpoint that takes a target user id.

Content is sealed with **AES-256-GCM using Node's built-in `crypto`** (no new dependency), under a
**single application-wide, versioned secret** supplied via env as a small **keyring**
(`NOTE_ENC_KEYS` = `version:key` entries + `NOTE_ENC_ACTIVE_VERSION`). New/updated notes use the
active version; any present version can decrypt; an unknown version or failed auth-tag makes the read
**fail closed** (error, never plaintext). Rotation is handled two ways (clarified): **lazy** — every
save re-encrypts that note to the active version — **plus** an **operator-run bulk re-encryption
CLI** that forces completion so the old version can be retired (retirement is guarded by a check that
no note still references it).

## Technical Context

**Language/Version**: TypeScript 5.6+ on Node.js 22 LTS (server); unchanged from 001/002.

**Primary Dependencies**: Express 5, Zod, better-sqlite3 — all already present. **No new dependency**:
encryption uses Node's built-in `node:crypto` (AES-256-GCM). `jose`/`google-auth-library`/
`cookie-parser` (from 002) are untouched.

**Storage**: Existing SQLite DB (better-sqlite3). The `note` table is **redefined** to be per-user
(`user_id` PK, `ciphertext` BLOB, `key_version` INTEGER, timestamps). `user` and `session` tables
(from 002) are unchanged. Encryption keys live in **env**, never in the DB.

**Testing**: Vitest (server unit + integration via Supertest) and Playwright e2e. New unit tests for
the cipher (round-trip, tamper detection, wrong-key/missing-version), the keyring (parse/validate),
and the repo (ownership scoping, lazy re-encrypt on save, bulk re-encrypt, retirement guard).
Integration tests for two-user isolation and unauth 401. E2e drives two distinct test-login users
(different `sub`) and asserts each sees only their own note.

**Target Platform**: Linux server (Node process) + existing browser SPA, single-instance deploy.

**Project Type**: Web application (existing `client/`, `server/`, `shared/` npm workspaces).

**Performance Goals**: AES-256-GCM on ≤10 KB plaintext is sub-millisecond and in-process; each
read/write still touches a single note row. No change to the existing local p95 < 200 ms target; no
extra DB round-trips on the hot path.

**Constraints**:
- One note per user; reads/writes scoped to the authenticated user (no cross-user addressing).
- Single app-wide **versioned** secret; multiple versions coexist during rotation; secrets only in
  env, never in the DB, never sent to the client, never logged.
- **Fail closed**: a note whose key version is absent (or whose auth tag fails) is never served as
  plaintext; startup refuses to boot if the active key version is missing/malformed.
- Plaintext length limit (10,000 chars) enforced **before** encryption (reuse existing validation).

**Scale/Scope**: Small number of users, one note each. New: a `crypto/` module (keyring + cipher), a
reworked `note` table + repo, a tiny operator re-encryption CLI, and env additions. The public HTTP
contract shape is **unchanged** (GET/PUT `/api/note`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|-----------|--------|----------------------------|
| I | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Tests written with/before code at every layer: **unit** — cipher round-trip + GCM tamper rejection + wrong-key/missing-version, keyring parse/validate + fail-closed startup, repo ownership-scoping + lazy re-encrypt-on-save + bulk re-encrypt + retirement guard; **integration (Supertest)** — user A and user B get independent notes, A can never observe B's content, unauth → 401, a row with an unknown key version → fail-closed error (not plaintext); **contract** — GET/PUT `/api/note` still satisfy the unchanged OpenAPI shapes; **e2e** — two test-login users (distinct `sub`) each see only their own note. All wired into CI; merge blocked unless green. |
| II | Keep It Simple | ✅ PASS | **No new dependency** — Node built-in `crypto` (AES-256-GCM). Smallest schema change (one table redefined, two columns added: `ciphertext`, `key_version`). Ownership is enforced by the `user_id` primary key rather than added authorization logic. Single app-wide versioned key (clarified) instead of per-user keys or a KMS. The `key_version` column + env keyring + bulk-re-encrypt CLI are **required by the explicit rotation requirement** (FR-010–FR-014), not speculative → Complexity Tracking left empty. |
| III | Typed End to End | ✅ PASS | Keyring, cipher, and repo are fully typed; new env vars validated via Zod (extending the existing `loadEnv`). The `Note` API shape is **unchanged**, so `shared/src/api.ts` needs no regeneration and client/server keep one contract-derived source. `any` avoided; `tsc --noEmit` in CI. |
| IV | Accessible by Default | ✅ PASS | **No client UI changes**: the existing note editor already calls GET/PUT `/api/note` and already renders the empty state when `note` is `null`; making the note per-user is a server-side concern. The accessibility baseline established in 001/002 is therefore preserved unchanged (no new components, no markup changes). |
| V | Small Pull Requests | ✅ PASS | Sliced into independently mergeable steps: (1) `crypto/` module (keyring + cipher) + env additions + unit tests; (2) per-user `note` table + repo rework + route scoping + integration/contract tests; (3) rotation — bulk re-encryption CLI + retirement guard + tests. Each is reviewable in one sitting. |

**Merge gates** (constitution Development Workflow): a PR merges only when (1) tests pass and
(2) `tsc` type-check passes. (No UI changes here, so the accessibility gate is N/A but unbroken.)

**Result**: PASS. No violations requiring justification → Complexity Tracking left empty.

**Post-design re-check (after Phase 1)**: Still PASS. The reworked `note` table, the env keyring, the
`crypto/` module, the user-scoped repo/routes, and the operator CLI add no abstraction beyond what
the rotation requirement demands. Secrets stay in env (mirroring the existing `AUTH_JWT_SECRET`
pattern), nothing is logged, and the public contract shape is untouched. All five principles remain
satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/004-note-ownership-encryption/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification (+ Clarifications)
├── research.md          # Phase 0 output — decisions D1–D8
├── data-model.md        # Phase 1 output — reworked note table + keyring model
├── quickstart.md        # Phase 1 output — key setup, run, test, rotation runbook
├── contracts/
│   ├── note-api.md      # Phase 1 — HTTP behavior delta (shapes unchanged; new fail-closed error)
│   └── reencrypt-cli.md # Phase 1 — operator bulk re-encryption command contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root) — additions/changes to the existing layout

```text
server/
├── src/
│   ├── app.ts                    # PASS the keyring into createNoteRouter; AppOptions gains `encryption`
│   ├── server.ts                 # validate new NOTE_ENC_* env at startup (fail closed)
│   ├── config/
│   │   └── env.ts                # EXTEND Zod schema: NOTE_ENC_KEYS + NOTE_ENC_ACTIVE_VERSION → Keyring
│   ├── crypto/
│   │   ├── keyring.ts            # NEW: parse/validate env keyring; getActiveVersion/getKey/listVersions
│   │   └── note-cipher.ts        # NEW: AES-256-GCM seal()/open() over (nonce||ciphertext||tag) BLOB
│   ├── db/
│   │   ├── index.ts              # REWORK: redefine `note` table (user_id PK, ciphertext, key_version)
│   │   └── note-repo.ts          # REWORK: per-user get/upsert (encrypt/decrypt), bulk re-encrypt,
│   │                             #   notesUsingVersion (retirement guard), clearNote (all rows)
│   ├── routes/
│   │   └── note.ts               # SCOPE get/put to req.user.id; map decrypt failure → fail-closed error
│   └── cli/
│       └── reencrypt-notes.ts    # NEW: operator bulk re-encryption + per-version count report
└── tests/
    ├── unit/                     # note-cipher, keyring, note-repo
    ├── integration/              # two-user isolation, unauth 401, fail-closed read
    └── contract/                 # GET/PUT /api/note vs unchanged openapi.yaml

server/package.json               # ADD script: "reencrypt": runs src/cli/reencrypt-notes.ts (tsx)

e2e/
└── note-isolation.spec.ts        # NEW: two test-login users (distinct sub) → each sees only own note

contracts/openapi.yaml            # (root) unchanged shapes; update note path descriptions to "per-user"
```

**Structure Decision**: Keep the existing web-app layout (npm workspaces `client/`, `server/`,
`shared/`). Encryption lives in a cohesive new `server/src/crypto/` module; ownership lives in the
reworked `note` table + repo; the operator command lives in `server/src/cli/`. Keys come from env via
`config/env.ts` (mirroring the existing `AUTH_JWT_SECRET` pattern). The OpenAPI contract keeps its
current `Note`/`NoteInput`/`NoteResponse` shapes — only behavior and storage change — so
`shared/src/api.ts` is not regenerated. **No client changes** are required.

## Complexity Tracking

> No constitution violations — this section intentionally left empty. (The `key_version` column, the
> env keyring with coexisting versions, and the bulk re-encryption CLI are each required by the
> explicit encryption-with-rotation requirements FR-008–FR-016, so none constitutes unjustified
> complexity.)
