# Phase 0 Research: User Settings Page — Manage Contacts

**Feature**: 006-user-settings-contacts | **Date**: 2026-06-07

This feature has no novel technology unknowns — it reuses the stack and patterns established by
001/002/004. Research therefore focuses on the **design decisions** that shape the data model,
contract, and UI, each resolved against the constitution (Keep It Simple) and the existing codebase.

---

## D1 — Multi-type storage shape (FR-010)

**Decision**: A single `contact` table with an explicit `type TEXT NOT NULL` column (value `email`
this release) and a generic `value TEXT NOT NULL` column. One table for all future types.

**Rationale**: The spec mandates the structure support future types (phone, username) **without
migrating existing rows** (FR-010, SC-007). A `(type, value)` pair in one table achieves this: adding
a type later is a code/validation change only — existing email rows are untouched. This is the
simplest shape that satisfies the requirement.

**Alternatives considered**:
- *One table per type* (`email_contact`, `phone_contact`, …): more tables, duplicated repo/route
  logic, and a UI that must union sources — rejected (violates Keep It Simple; no present benefit).
- *Type-specific columns on one row* (`email`, `phone` columns): sparse, requires a migration per new
  type — rejected (defeats FR-010).
- *JSON blob `data` column*: untyped, defeats the per-type validation and the DB-level uniqueness
  constraint — rejected (violates Typed End to End and complicates dedup).

---

## D2 — Duplicate detection with original-case display (FR-008, FR-013)

**Decision**: Store two columns: `value` (the address **as entered**, trimmed, original case
preserved — used for display) and `value_norm` (trimmed + lowercased — used only for matching).
Enforce uniqueness with `UNIQUE (user_id, type, value_norm)` at the DB level; the repo also checks
before insert to return a friendly error.

**Rationale**: The clarification requires preserving display casing while detecting duplicates
case-insensitively. A separate normalized column makes both deterministic and pushes the integrity
guarantee into the database (defense in depth against races), mirroring how 002 uses a `UNIQUE`
constraint on `session.token_hash`.

**Alternatives considered**:
- *Lowercase on store* (single column): simpler, but loses the user's original casing — rejected by
  the clarification (preserve original case).
- *App-only dedup (no DB constraint)*: a concurrent double-submit could create duplicates — rejected
  (the UNIQUE constraint is cheap and closes the race).

---

## D3 — Contact identity / primary key

**Decision**: `id TEXT PRIMARY KEY` populated with `node:crypto.randomUUID()` at insert time; the
owner is a separate `user_id` foreign key.

**Rationale**: Unlike `note` (one row per user → `user_id` is the PK), a user has **many** contacts,
so each needs its own stable id for `DELETE /api/contact/:id`. `randomUUID()` is built in (no new
dependency) and already used elsewhere (002 tokens). A random id avoids exposing enumerable sequence
numbers in URLs.

**Alternatives considered**:
- *Autoincrement integer PK*: enumerable, and `better-sqlite3` rowids leak ordering — rejected for a
  per-user resource exposed in a URL.
- *Composite PK `(user_id, value_norm)`*: would couple the delete URL to the email value — rejected
  (awkward routing; value can contain URL-unsafe characters).

---

## D4 — HTTP shape and status codes (FR-004, FR-005, FR-007, FR-008, FR-015)

**Decision**: Three operations under `/api/contact`, all behind `requireAuth`:
- `GET /api/contact` → `200 { contacts: Contact[] }`
- `POST /api/contact` (body `ContactInput { type, value }`) → `201 Contact`
- `DELETE /api/contact/:id` → `204` (idempotent)

Error mapping:
- `400 VALIDATION_ERROR` — missing fields, unsupported `type`, malformed email, value > 320 chars.
- `409 DUPLICATE_CONTACT` — normalized value already present for this user/type.
- `409 CONTACT_LIMIT_REACHED` — user already has 50 contacts.
- `401 UNAUTHORIZED` — no valid session (from `requireAuth`).

**Rationale**: Mirrors the existing `Error { error, message }` convention and the note route's
validation-first flow. `409 Conflict` correctly models both "already exists" and "no room for more"
(state conflicts), keeping `400` strictly for malformed input — this lets the client show distinct
messages and lets tests assert precise codes. `DELETE` is idempotent (returns `204` whether or not a
row matched) to satisfy the "remove an already-deleted contact reports state without error" scenario
(US3 #3).

**Alternatives considered**:
- *PUT whole-list semantics* (replace the array): larger payloads, lost-update risk, and harder
  partial-failure handling — rejected; add/remove are the spec's operations.
- *`200` with empty body for POST*: returning the created `Contact` lets the client render it (and its
  server-assigned `id`) without a refetch — chosen instead.

---

## D5 — Email validation strictness (FR-007)

**Decision**: Validate with Zod `z.string().trim().max(320).email()` (plus `type === "email"`),
returning the first issue's message via the existing `ParseResult` union. Normalize for storage in
the repo (the route passes the trimmed value through; the repo derives `value_norm`).

**Rationale**: Zod's `.email()` is a pragmatic, well-tested syntactic check consistent with "well-
formed email" (FR-007) and needs no new dependency. 320 is the practical maximum length of an email
address (64-char local part + `@` + 255-char domain), matching the clarified bound (FR-014). Deeper
verification (MX lookup, sending a confirmation) is explicitly out of scope this release.

**Alternatives considered**:
- *Hand-rolled regex*: error-prone and redundant given Zod is already a dependency — rejected.
- *Accept anything, validate later*: violates FR-007 (reject invalid before saving) — rejected.

---

## D6 — Client structure & navigation

**Decision**: Add a protected `/settings` route rendering a `SettingsPage` (page shell: header with
the user's email + sign-out, consistent with the note page) that hosts a `ContactList` component
(list + empty state + add form + per-row remove). A `contactClient.ts` API module (using the shared
`apiFetch`) provides `getContacts`/`addContact`/`removeContact`. Add a visible link to **Settings**
from the existing main (note) page header and a link back, so the page is reachable.

**Rationale**: Directly mirrors the `NotePage` + `NoteEditor` + `noteClient.ts` trio and the existing
`<ProtectedRoute>` pattern, so the slice is low-risk and consistent. The status discriminated union
(`loading | idle | adding | removing | error`) and ARIA live regions are reused from `NoteEditor`,
satisfying the accessibility principle by construction.

**Alternatives considered**:
- *Embed contacts on the existing note page*: conflates two concerns and contradicts the spec's
  intent of a dedicated settings page that will grow more sections — rejected.

---

## D7 — Encryption at rest for contacts

**Decision**: Store contact `value`/`value_norm` as **plaintext** (no encryption at rest).

**Rationale**: The spec imposes **no** confidentiality/encryption requirement on contacts; the
AES-256-GCM scheme from 004 was scoped specifically to **note content**. Applying it here would add a
keyring dependency, ciphertext columns, and fail-closed read handling with **no present requirement**
— a direct Keep-It-Simple (Principle II / YAGNI) violation. Note also that `value_norm` must be
queryable for the UNIQUE dedup constraint, which encryption would defeat without a separate keyed
hash. This decision is recorded explicitly so it is a conscious trade-off; if a future requirement
demands encrypting PII contacts, the 004 `crypto/` module is the established, reusable pattern to
extend.

**Alternatives considered**:
- *Reuse 004 note encryption for contacts*: rejected now (no requirement, breaks dedup query, adds
  complexity); flagged as the clear future path if a requirement appears.

---

## D8 — Test-reset seam extension

**Decision**: Extend the existing `POST /api/test/reset` handler (gated by `enableTestReset`, never
in production) to also call `clearContacts(db)` alongside `clearNote(db)`.

**Rationale**: e2e and contract suites already rely on this single reset seam to get a clean slate
between tests; extending it keeps test setup uniform and avoids a second reset endpoint. `loginAs`
(distinct `sub` per user) already supports the two-user isolation tests.

**Alternatives considered**:
- *Separate `/api/test/reset-contacts`*: more endpoints, divergent test setup — rejected.

---

## Resolved unknowns

All Technical Context items are concrete; **no `NEEDS CLARIFICATION` remain**. The four spec
clarifications (no verification, 50-contact cap, 320-char limit, preserve original case) are encoded
in D2/D4/D5 and the data model.
