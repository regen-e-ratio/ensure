# Contract: Note HTTP API (behavior delta)

**Feature**: 004-note-ownership-encryption | **Date**: 2026-06-06

The **request/response shapes are unchanged** from the existing `contracts/openapi.yaml`
(`Note`, `NoteInput`, `NoteResponse`, error envelope `{ error, message }`). This feature changes the
**semantics** (now the caller's *own* note) and adds **one new error condition** (fail-closed
decryption). `shared/src/api.ts` is **not** regenerated. Both endpoints remain behind `requireAuth`.

Owner is always `req.user.id` (set by `requireAuth`). **No endpoint accepts a target user id**, so a
caller can only ever address their own note (isolation by construction — FR-002…FR-005).

---

## GET /api/note  (read the caller's own note)

| Case | Status | Body | Requirement |
|------|--------|------|-------------|
| Caller has a note | `200` | `{ "note": { "text": "<decrypted>", "createdAt": "...", "updatedAt": "..." } }` | FR-003, FR-009 |
| Caller has no note yet | `200` | `{ "note": null }` | FR-006 |
| Not authenticated | `401` | `{ "error": "UNAUTHORIZED", "message": "Sign in to continue." }` | FR-007 |
| Caller's note can't be decrypted (key version absent / auth-tag fails) | `500` | `{ "error": "NOTE_DECRYPT_FAILED", "message": "<generic>" }` — **never** plaintext | FR-015 |

- A different user's saved note is **never** observable here: each caller's query is scoped to their
  own `user_id`, so user B sees `null` (or B's own note), never A's content (FR-003, FR-005).

## PUT /api/note  (create or replace the caller's own note)

Request body: `NoteInput` = `{ "text": string }` (unchanged).

| Case | Status | Body | Requirement |
|------|--------|------|-------------|
| Valid text | `200` | `{ "note": { "text": "<echoed>", "createdAt": "...", "updatedAt": "..." } }` | FR-004, FR-012 |
| Empty / whitespace-only / too long (>10,000) | `400` | `{ "error": "VALIDATION_ERROR", "message": "..." }` | FR-017 |
| Not authenticated | `401` | `{ "error": "UNAUTHORIZED", "message": "Sign in to continue." }` | FR-007 |

- On every successful save the note is (re-)encrypted with the **active** key version, which performs
  **lazy migration** of a note previously sealed under an older version (FR-012a).
- Saving creates the caller's note if absent or replaces it in place; `created_at` is preserved,
  `updated_at` advances (FR-018, FR-019).

---

## Contract tests (must pass)

- GET with no note → `200 { note: null }`; PUT then GET round-trips the exact text (decrypts equal to
  input).
- Two authenticated users (distinct `sub`): A saves "alpha", B saves "beta" → A GET returns "alpha",
  B GET returns "beta"; neither ever sees the other's text (FR-003, FR-005).
- Unauthenticated GET/PUT → `401`.
- PUT empty/whitespace/over-limit → `400` with the existing validation messages.
- A note row whose `key_version` is not in the keyring → GET returns `500 NOTE_DECRYPT_FAILED`, body
  contains **no** note text (FR-015).
- Stored `ciphertext` for a saved note does **not** contain the plaintext bytes (FR-008).
