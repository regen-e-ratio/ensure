# Phase 1 Data Model: Per-User Note Ownership & Encryption at Rest

**Feature**: 004-note-ownership-encryption | **Date**: 2026-06-06

This feature **reworks** the `note` table and introduces an env-derived **keyring** (not a table).
The `user` and `session` tables from 002 are unchanged and shown only for context.

---

## Entity: Note (reworked)

A single text entry **owned by exactly one user**, stored **encrypted**. At most one note per user.

### Schema

```sql
CREATE TABLE IF NOT EXISTS note (
  user_id     TEXT    PRIMARY KEY REFERENCES user(id),
  ciphertext  BLOB    NOT NULL,   -- nonce(12) || ciphertext || GCM tag(16)
  key_version INTEGER NOT NULL,   -- keyring version that protects this row
  created_at  TEXT    NOT NULL,   -- ISO 8601; preserved across updates
  updated_at  TEXT    NOT NULL    -- ISO 8601; advanced on every save
);

CREATE INDEX IF NOT EXISTS idx_note_key_version ON note(key_version);
```

> **Change from prior schema**: the old singleton `note (id INTEGER PRIMARY KEY CHECK (id = 1), text
> TEXT NOT NULL, created_at, updated_at)` is removed. The plaintext `text` column no longer exists;
> `user_id` (PK) replaces the `id = 1` singleton; `ciphertext` + `key_version` are added.

### Fields

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | TEXT (PK, FK → `user.id`) | The owner (Google `sub`). PK ⇒ exactly one note per user (FR-001, FR-018). |
| `ciphertext` | BLOB | `nonce ‖ ciphertext ‖ authTag` from AES-256-GCM. Never plaintext (FR-008). |
| `key_version` | INTEGER | Keyring version used to encrypt this row; chooses the decrypt key (FR-010). |
| `created_at` | TEXT (ISO 8601) | Set on first save; preserved on update. |
| `updated_at` | TEXT (ISO 8601) | Advanced on every save (last-write-wins for the same user; FR-019). |

### Domain rules / invariants

- **Ownership & cardinality**: `user_id` PK guarantees ≤1 note per owner and ties it to one user.
- **Length**: plaintext validated to ≤ `NOTE_MAX_LENGTH` (10,000) and non-empty **before** encryption
  (reuse existing `parseNoteInput`; FR-017). The 10,000-char limit applies to plaintext, not ciphertext.
- **Encryption invariant**: a row's `ciphertext` is always decryptable by `getKey(key_version)`;
  if that key is absent or the auth tag fails, reads **fail closed** (FR-015), never returning plaintext.
- **Key-version invariant**: `upsertNote` always writes `key_version = keyring.getActiveVersion()`.

### State transitions

| Trigger | Effect on `key_version` |
|---------|-------------------------|
| First save (create) | set to active version |
| Owner updates note | re-encrypt with active version → `key_version = active` (**lazy migration**, FR-012a) |
| Operator bulk re-encryption | rows where `key_version ≠ active` → decrypt(old) → encrypt(active) → `key_version = active` (FR-013) |
| Key version removed from env | only permitted once `notesUsingVersion(v) = 0` (retirement guard, FR-014) |

---

## Entity: Encryption Keyring (configuration, not persisted)

A single application-wide, **versioned** secret, supplied via env. Not a database table; lives only in
process memory after startup. Never stored with note data, never sent to clients, never logged (FR-016).

### Source (environment variables)

| Variable | Format | Meaning |
|----------|--------|---------|
| `NOTE_ENC_KEYS` | `v:base64key` entries, comma-separated, e.g. `1:<b64-32B>,2:<b64-32B>` | All known key versions available for **decryption**. |
| `NOTE_ENC_ACTIVE_VERSION` | integer, e.g. `2` | The version used to **encrypt** new/updated notes; MUST appear in `NOTE_ENC_KEYS`. |

### Derived shape (in code)

```ts
type KeyVersion = number;

interface Keyring {
  getActiveVersion(): KeyVersion;
  getKey(version: KeyVersion): Buffer;      // 32 bytes; throws if version unknown
  listVersions(): KeyVersion[];
  hasVersion(version: KeyVersion): boolean;
}
```

### Validation rules (fail closed at startup — FR-015)

- `NOTE_ENC_KEYS` parses into ≥1 entries; each value base64-decodes to **exactly 32 bytes**.
- Versions are positive integers and unique.
- `NOTE_ENC_ACTIVE_VERSION` is present and **exists** in the parsed keyring.
- On any violation, `loadEnv` throws and the server refuses to boot (mirrors `AUTH_JWT_SECRET`).

---

## Entity: User (unchanged — context only)

From 002. Identified by Google `sub` (`user.id`). Referenced by `note.user_id`. No changes here.

```sql
-- existing, unchanged
CREATE TABLE IF NOT EXISTS user (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT,
  created_at    TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);
```

---

## Repository surface (server/src/db/note-repo.ts — reworked)

| Function | Signature (conceptual) | Purpose |
|----------|------------------------|---------|
| `getNote` | `(db, userId, keyring) → Note \| null` | Read+decrypt the caller's own note (or null). Fail closed on missing key / bad tag. |
| `upsertNote` | `(db, userId, text, keyring, now?) → Note` | Encrypt with active version and create/replace the caller's note (lazy migration). |
| `reencryptAll` | `(db, keyring) → { migrated: number; perVersion: Record<number, number> }` | Bulk re-encrypt non-active rows to active (operator CLI, FR-013). |
| `notesUsingVersion` | `(db, version) → number` | Count rows still on a version (retirement guard, FR-014). |
| `clearNote` | `(db) → void` | Test-only: delete all note rows (e2e reset). |

`Note` returned to callers keeps the existing shape `{ text, createdAt, updatedAt }` (plaintext `text`
is the decrypted content) — so the HTTP contract and `shared/src/api.ts` are unchanged.

---

## Migration / setup

Pre-launch, **no production data** (research D7). For existing local/e2e databases, delete the SQLite
file (and `-wal`/`-shm`) once so the reworked `note` table is created fresh; `test-reset` continues to
clear note rows between e2e runs. No backfill code ships.
