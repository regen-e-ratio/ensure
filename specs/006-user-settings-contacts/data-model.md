# Phase 1 Data Model: User Settings Page — Manage Contacts

**Feature**: 006-user-settings-contacts | **Date**: 2026-06-07

This feature **adds one table** (`contact`). The `user`, `session`, and `note` tables are unchanged
and shown only for context (the `contact.user_id` foreign key references `user.id`).

---

## Entity: Contact (new)

A single way to reach or identify a user — currently an email address — **owned by exactly one
user**. A user may hold **0–50** contacts (FR-011, FR-015).

### Schema

```sql
CREATE TABLE IF NOT EXISTS contact (
  id          TEXT NOT NULL PRIMARY KEY,            -- randomUUID(); stable id for DELETE /:id
  user_id     TEXT NOT NULL REFERENCES user(id),    -- owner (Google sub); never client-supplied
  type        TEXT NOT NULL,                        -- 'email' now; future: 'phone' | 'username'
  value       TEXT NOT NULL,                         -- as entered, trimmed, ORIGINAL CASE (display)
  value_norm  TEXT NOT NULL,                         -- trimmed + lowercased (dedup key only)
  created_at  TEXT NOT NULL,                         -- ISO 8601
  UNIQUE (user_id, type, value_norm)                 -- case-insensitive per-user uniqueness (FR-008)
);

CREATE INDEX IF NOT EXISTS idx_contact_user_id ON contact(user_id);
```

> **Why two value columns**: `value` preserves the user's original casing for display (FR-013);
> `value_norm` is the case-insensitive key the `UNIQUE` constraint and duplicate check use (FR-008,
> D2). For `type = 'email'`, `value_norm = value.toLowerCase()` (both already trimmed).

### Fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | TEXT (PK) | `crypto.randomUUID()` assigned by the server on add. Exposed in `DELETE /api/contact/:id`. |
| `user_id` | TEXT (FK → `user.id`) | The owner. Always `req.user.id`; there is **no** endpoint accepting a target user (FR-003, FR-012). |
| `type` | TEXT | `'email'` only this release; rejected otherwise (FR-006). Column exists so future types need no migration (FR-010, SC-007). |
| `value` | TEXT | Email as entered, trimmed; original case preserved for display (FR-013). ≤ 320 chars (FR-014). |
| `value_norm` | TEXT | Trimmed + lowercased form; used only for duplicate detection / the UNIQUE constraint (FR-008). Not returned to clients. |
| `created_at` | TEXT (ISO 8601) | Set on insert. (No `updated_at`: contacts are add/remove only — no in-place edit, per Assumptions.) |

### Public shape (API / `Contact` schema)

The repo maps a row to the wire `Contact` (`value_norm` is **internal**, never serialized):

```jsonc
{
  "id": "f3b1…",                 // string
  "type": "email",               // "email"
  "value": "Alice@Example.com",  // original case
  "createdAt": "2026-06-07T10:00:00.000Z"
}
```

### Domain rules / invariants

- **Ownership & scoping**: every row has a `user_id`; all queries filter by `user_id = req.user.id`.
  Cross-user reads/writes are structurally impossible (FR-003, FR-012).
- **Type whitelist**: `type` MUST be `'email'`; any other value is rejected at validation (FR-006).
- **Length**: `value` MUST be ≤ `CONTACT_MAX_LENGTH` (320) and non-empty after trim, validated
  **before** insert (FR-014). The 320 limit applies to the entered value.
- **Email well-formedness**: `value` MUST pass email validation when `type = 'email'` (FR-007).
- **Uniqueness**: at most one row per `(user_id, type, value_norm)` (FR-008); enforced by the DB
  constraint and an explicit pre-insert check (friendly `409 DUPLICATE_CONTACT`).
- **Cardinality cap**: a user MUST NOT exceed `CONTACT_LIMIT` (50) contacts; the add path counts
  existing rows and rejects with `409 CONTACT_LIMIT_REACHED` when full (FR-015).
- **Immutability**: rows are created and deleted, never updated (no edit flow this release).

### Lifecycle / state transitions

| Trigger | Effect |
|---------|--------|
| Add (POST) — valid, non-duplicate, under cap | INSERT new row with fresh `id`, derived `value_norm`, `created_at = now` |
| Add — invalid email / wrong type / too long | No write; `400 VALIDATION_ERROR` |
| Add — duplicate `value_norm` for user/type | No write; `409 DUPLICATE_CONTACT` |
| Add — user already at 50 | No write; `409 CONTACT_LIMIT_REACHED` |
| Remove (DELETE /:id) — row owned by user exists | DELETE row; `204` |
| Remove (DELETE /:id) — no matching owned row | No-op; `204` (idempotent, US3 #3) |
| Test reset (`POST /api/test/reset`, non-prod) | DELETE all contact rows (`clearContacts`) |

---

## Repository surface (`server/src/db/contact-repo.ts`)

Mirrors the `note-repo.ts` module style (functions take `(db, …)`, prepared statements, row→type
mapping):

| Function | Signature (conceptual) | Purpose |
|----------|------------------------|---------|
| `listContacts` | `(db, userId) → Contact[]` | All of a user's contacts, ordered by `created_at` |
| `countContacts` | `(db, userId) → number` | Used by the add path to enforce the 50 cap |
| `findByNormalized` | `(db, userId, type, valueNorm) → Contact \| null` | Pre-insert duplicate check |
| `addContact` | `(db, userId, type, value, now?) → Contact` | Derives `value_norm`, assigns `id`, INSERTs, returns the row |
| `removeContact` | `(db, userId, id) → boolean` | Scoped DELETE; returns whether a row matched |
| `clearContacts` | `(db) → void` | Test-reset seam only |

---

## Shared constants (`shared/src/constants.ts`)

```ts
export const CONTACT_MAX_LENGTH = 320; // FR-014 — max email value length
export const CONTACT_LIMIT = 50;       // FR-015 — max contacts per user
```

Both are re-exported from `shared/src/index.ts` and consumed by server validation and the client UI
(e.g. input `maxLength`, disabling the add control at the cap).

---

## Unchanged tables (context)

- **`user`** (`id` PK, `email`, `name`, `created_at`, `last_login_at`) — `contact.user_id` → `user.id`.
- **`session`**, **`note`** — untouched by this feature.
