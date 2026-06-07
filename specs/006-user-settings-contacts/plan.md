# Implementation Plan: User Settings Page — Manage Contacts

**Branch**: `006-user-settings-contacts` | **Date**: 2026-06-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-user-settings-contacts/spec.md`

## Summary

Add a **user settings page** whose only section (for now) is a **contact list** the signed-in
user can **read, add to, and remove from**. Only **email** contacts are accepted in this release,
but the storage is shaped for **multiple contact types** from day one: every contact row carries an
explicit `type` column (`email` today; `phone`/`username` later) so future types need **no
migration of existing rows** (FR-010, SC-007).

A new **`contact` table** (keyed by its own `id`, owned via `user_id`) holds the email **as entered**
(trimmed, original case preserved) plus a **normalized form** (`value_norm` = trimmed + lowercased)
used solely for **case-insensitive duplicate detection** via a `UNIQUE (user_id, type, value_norm)`
constraint (FR-008, FR-013). All reads/writes are scoped to `req.user.id` behind the existing
`requireAuth` middleware (from 002), so cross-user access is **structurally impossible** — no
endpoint takes a target user id (FR-003, FR-012). A per-user **cap of 50** (FR-015) and a **320-char**
value limit (FR-014) are enforced server-side. Contacts are **not** verified (no confirmation email)
this release (clarified).

The public HTTP surface gains three operations under `/api/contact`
(`GET` list, `POST` add, `DELETE /:id` remove), defined in `contracts/openapi.yaml` and surfaced to
both client and server through the generated `shared/src/api.ts`. The client gets a `/settings`
route (a `SettingsPage` + `ContactList` component following the existing `NoteEditor` pattern) and a
`contactClient.ts` API module.

## Technical Context

**Language/Version**: TypeScript 5.6+ on Node.js 22 (server) and the browser SPA (client); unchanged
from 001/002/004.

**Primary Dependencies**: Express 5, Zod, better-sqlite3 (server); React + React Router (client);
all already present. **No new runtime dependency** — contact IDs use Node's built-in
`node:crypto.randomUUID()` (already used by 002 for tokens/sessions).

**Storage**: Existing SQLite DB (better-sqlite3). **One new table `contact`**; `user`, `session`,
and `note` tables are unchanged. Contacts are stored **as plaintext** (see research.md D7 — the spec
imposes no encryption-at-rest requirement on contacts; the encryption added in 004 was specific to
note content).

**Testing**: Vitest (server unit + contract via Supertest; client via React Testing Library) and
Playwright e2e — all already configured. New tests: validation unit, repo unit (dedup, cap, scoping,
case preservation), contract tests for list/add/remove + two-user isolation, client component tests
for the settings page, and an e2e flow (add/remove persist; per-user isolation).

**Target Platform**: Linux server (Node process) + existing browser SPA, single-instance deploy.

**Project Type**: Web application (existing npm workspaces `client/`, `server/`, `shared/`).

**Performance Goals**: Each operation touches a single small table with indexed `user_id`; list/add/
remove are sub-millisecond in-process. No change to the existing local p95 < 200 ms target.

**Constraints**:
- Reads/writes scoped to the authenticated user; no cross-user addressing (FR-003, FR-012).
- Email only this release: any non-`email` `type` is rejected (FR-006).
- Value ≤ 320 chars (FR-014); ≤ 50 contacts per user (FR-015); both enforced server-side.
- Duplicate detection is case-insensitive + whitespace-trimmed via `value_norm`; stored `value`
  preserves original case for display (FR-008, FR-013).
- No verification/confirmation email; adding simply records the address (clarified).

**Scale/Scope**: Small number of users, ≤ 50 contacts each. New: a `contact` table + repo, a
`contact` validation module, a `contact` route, a settings page + contact-list component + client API
module, OpenAPI additions, two shared constants, and tests at every layer.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|-----------|--------|----------------------------|
| I | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Tests written with/before code at every layer: **unit** — email/type/length validation, repo dedup (case-insensitive) + 50-cap rejection + user-scoping + original-case preservation; **contract (Supertest)** — `GET/POST/DELETE /api/contact` happy + error paths (invalid email, unsupported type, duplicate, limit, unauth 401, idempotent delete), and two-user isolation (A never sees/affects B); **client** — settings page empty state, list render, add (success/validation/duplicate/limit), remove; **e2e** — add/remove persist across reload, two distinct test-login users see only their own contacts. All wired into CI; merge blocked unless green. |
| II | Keep It Simple | ✅ PASS | Smallest design that meets the spec: **one** new table, repo, validation module, route, page, component, and client API module — each mirroring an existing counterpart (`note`). **No new dependency** (`randomUUID` is built in). Ownership enforced by `user_id` scoping + the existing `requireAuth`, not new authorization code. The `type` column + `value_norm`/UNIQUE constraint are **required by explicit requirements** (FR-010 multi-type, FR-008 dedup), not speculative. Contacts are **not** encrypted (no spec requirement) — avoiding unjustified complexity (D7). → Complexity Tracking left empty. |
| III | Typed End to End | ✅ PASS | `Contact`/`ContactInput`/`ContactListResponse` defined once in `contracts/openapi.yaml`, generated into `shared/src/api.ts` (`npm run gen:api`), and consumed by both client (`contactClient.ts`) and server (`contact-repo.ts`, route). Input validated with Zod; `ParseResult` discriminated union as in `validation/note.ts`. `any` avoided; `tsc --noEmit` in CI. |
| IV | Accessible by Default | ✅ PASS | Settings page is keyboard-navigable and semantic: the contact list is a `<ul>`/`<li>`; the add form has a `<label>`-bound email `<input type="email">` and a submit `<button>`; each contact has an accessibly-named "Remove" button; status/errors use `role="status"` (aria-live polite) and `role="alert"`, mirroring `NoteEditor`. WCAG AA contrast inherited from existing styles. |
| V | Small Pull Requests | ✅ PASS | Sliced into independently mergeable steps: **(1)** contract + shared constants + server (table, repo, validation, route, test-reset extension) + server tests; **(2)** client settings page + contact API module + navigation wiring + client tests; **(3)** e2e isolation/persistence spec + README Architecture update. Each is reviewable in one sitting. |

**Merge gates** (constitution Development Workflow): a PR merges only when (1) tests pass,
(2) `tsc` type-check passes, and (3) the new UI meets the accessibility baseline.

**Result**: PASS. No violations requiring justification → Complexity Tracking left empty.

**Post-design re-check (after Phase 1)**: Still PASS. The `contact` table, repo, validation, route,
and the settings page/component add no abstraction beyond what the spec demands. The `type` column
and normalized-value uniqueness are mandated by FR-010 and FR-008 respectively; storage stays
plaintext (no speculative crypto); the public contract mirrors the existing Note style. All five
principles remain satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/006-user-settings-contacts/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification (+ Clarifications)
├── research.md          # Phase 0 output — decisions D1–D8
├── data-model.md        # Phase 1 output — the contact table + validation rules
├── quickstart.md        # Phase 1 output — run, test, and manual-verify the settings page
├── contracts/
│   └── contact-api.md   # Phase 1 — HTTP contract for GET/POST/DELETE /api/contact
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root) — additions/changes to the existing layout

```text
contracts/openapi.yaml              # ADD: /contact + /contact/{id} paths; Contact, ContactInput,
                                    #      ContactListResponse schemas (Note style)

shared/src/
├── constants.ts                    # ADD: CONTACT_MAX_LENGTH (320), CONTACT_LIMIT (50)
├── index.ts                        # ADD: re-export the two new constants
└── api.ts                          # REGENERATED via `npm run gen:api` from openapi.yaml

server/
├── src/
│   ├── app.ts                      # MOUNT: app.use("/api/contact", requireAuth, createContactRouter(db))
│   │                               #   and EXTEND test-reset to clearContacts(db)
│   ├── db/
│   │   ├── index.ts                # ADD `contact` table DDL + indexes (in openDb)
│   │   └── contact-repo.ts         # NEW: listContacts, addContact, removeContact, countContacts,
│   │                               #      findByNormalized, clearContacts (test-reset)
│   ├── validation/
│   │   └── contact.ts              # NEW: Zod schema — type === "email", valid email, ≤320; ParseResult
│   └── routes/
│       └── contact.ts              # NEW: GET / (list), POST / (add), DELETE /:id (remove); user-scoped
└── tests/
    ├── unit/                       # contact-validation, contact-repo
    └── contract/                   # contact-list, contact-add, contact-remove, contact-isolation

client/
├── src/
│   ├── App.tsx                     # ADD protected route: /settings → <SettingsPage/>; nav link
│   ├── api/
│   │   └── contactClient.ts        # NEW: getContacts, addContact, removeContact (uses apiFetch)
│   ├── pages/
│   │   └── SettingsPage.tsx        # NEW: page shell (header + sign-out), renders <ContactList/>
│   └── components/
│       └── ContactList.tsx         # NEW: list + empty state + add form + remove; status union, ARIA
└── tests/
    └── components/                 # SettingsPage / ContactList tests (RTL)

e2e/
├── support/auth.ts                 # ADD resetContacts helper (or reuse POST /api/test/reset)
└── settings-contacts.spec.ts       # NEW: add/remove persist; two test-login users isolated

README.md                           # UPDATE Architecture section: new settings/contacts component +
                                    #   /api/contact endpoints + contact table (same commit as slice 1/2)
```

**Structure Decision**: Keep the existing web-app layout (npm workspaces `client/`, `server/`,
`shared/`). The feature mirrors the established `note` vertical slice end to end — table → repo →
validation → route on the server; OpenAPI → generated shared types; API module → page → component on
the client — so each new file has a direct, reviewed precedent. Contacts live in their own cohesive
files (`contact-*`) rather than extending note files, keeping each module single-purpose (Principle
II). No new env var or external service is introduced, so README **Manual setup**, **Run**, and
**Tests** command sections are unchanged; only the README **Architecture** section is updated to
record the new component, endpoints, and table.

## Complexity Tracking

> No constitution violations — this section intentionally left empty. (The `type` column and the
> `value_norm` + `UNIQUE(user_id, type, value_norm)` constraint are each required by explicit
> requirements — FR-010 multi-type support and FR-008 case-insensitive de-duplication — so neither
> constitutes unjustified complexity.)
