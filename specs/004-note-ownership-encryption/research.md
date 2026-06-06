# Phase 0 Research: Per-User Note Ownership & Encryption at Rest

**Feature**: 004-note-ownership-encryption | **Date**: 2026-06-06

This feature carried **no open `NEEDS CLARIFICATION` markers** out of `/speckit-specify` /
`/speckit-clarify` (the three clarified decisions are recorded in `spec.md` → Clarifications). The
research below records the design decisions that turn those clarified requirements into an
implementation approach consistent with the constitution (esp. Principle II, Keep It Simple).

---

## D1 — Encryption primitive: AES-256-GCM via Node built-in `crypto`

**Decision**: Encrypt note content with **AES-256-GCM** using the standard library `node:crypto`
(`createCipheriv`/`createDecipheriv`, `"aes-256-gcm"`). Store, per note, the 12-byte random nonce,
the ciphertext, and the 16-byte GCM auth tag concatenated as one BLOB: `nonce || ciphertext || tag`.

**Rationale**:
- **Authenticated encryption** gives confidentiality *and* integrity — a tampered or truncated row
  fails the auth-tag check on decrypt, which is exactly the signal needed for fail-closed reads
  (FR-015).
- **No new dependency** (Principle II): Node's `crypto` is built in; no native module to compile, no
  supply-chain surface added. Mirrors the project's existing minimal-dependency posture.
- AES-256-GCM is a widely vetted standard; 96-bit random nonces are the recommended GCM nonce size.

**Alternatives considered**:
- *libsodium / sodium-native (XChaCha20-Poly1305)*: excellent, but adds a native dependency for no
  capability we lack here.
- *AES-CBC + separate HMAC*: more moving parts and easy to get wrong (encrypt-then-MAC ordering,
  padding); GCM bundles integrity in one vetted construction.
- *Application-level ORM/field-encryption libraries*: heavier and opinionated; unnecessary for one
  field on one small table.

**Notes**: A fresh random nonce is generated per `seal()` call, so re-saving identical text still
produces different ciphertext. Keys are 32 bytes (256-bit).

---

## D2 — Key management & versioning: an env-provided keyring

**Decision**: A **single application-wide, versioned secret** (clarified) is supplied via environment
as a small keyring:
- `NOTE_ENC_KEYS` — one or more `version:base64key` entries, comma-separated
  (e.g. `1:Base64OfFirst32Bytes,2:Base64OfSecond32Bytes`).
- `NOTE_ENC_ACTIVE_VERSION` — the integer version used to encrypt **new/updated** notes.

A `keyring.ts` module parses and validates this at startup and exposes `getActiveVersion()`,
`getKey(version)`, and `listVersions()`. Each stored note row records its `key_version`, so the
correct key is selected on decrypt (FR-010). Any version present in the keyring can decrypt; only the
active version is used to encrypt.

**Rationale**:
- Coexisting versions in one keyring is precisely what makes **non-disruptive rotation** possible
  (FR-011): introduce v2 alongside v1, switch the active version, retire v1 later.
- Keys live **only in env** — never in the DB, never sent to clients, never logged (FR-016) —
  mirroring the existing `AUTH_JWT_SECRET` handling, so operators have one consistent secret model.
- Validated via the same Zod `loadEnv` path the project already uses, so a malformed/missing active
  key makes the process **refuse to boot** (fail closed, FR-015).

**Alternatives considered**:
- *External KMS / secrets manager (AWS KMS, Vault)*: overkill for a small single-instance app; adds
  infra and latency. Can be revisited if the deployment model grows (YAGNI).
- *Single key with no version*: cannot satisfy the rotation requirement at all.
- *Per-user keys*: explicitly rejected during clarification; more key-management complexity with no
  present requirement.

---

## D3 — Rotation migration strategy: lazy on save + operator bulk re-encryption

**Decision** (matches Clarification Q3 = "Both"):
- **Lazy**: `upsertNote` always encrypts with the **active** version, so any time an owner saves, that
  note is transparently migrated to the current key (FR-012, FR-012a).
- **Bulk**: an operator CLI (`server/src/cli/reencrypt-notes.ts`, exposed as
  `npm run reencrypt --workspace server`) decrypts every row still on a non-active version and
  re-encrypts it with the active version (FR-013), then prints a per-version count so the operator can
  see when zero notes remain on the old version.
- **Retirement guard**: a repo helper `notesUsingVersion(version)` (and the CLI's final report) lets
  the operator confirm a version is unused before removing it from `NOTE_ENC_KEYS`. Removing a key
  that still protects notes would make them unreadable, so the runbook requires the count to be 0
  first (FR-014).

**Rationale**: lazy keeps day-to-day usage zero-touch; the explicit bulk pass is the only way to
*guarantee* completion regardless of user activity, which is what allows the old key to be retired in
bounded time. Together they satisfy the full rotation story without a background scheduler.

**Alternatives considered**:
- *Lazy only*: an inactive user's note could pin an old key indefinitely → can never safely retire it.
- *Bulk only*: forces an ops action on every rotation even for active notes; no graceful drip.
- *Online/automatic rotation on a timer*: adds a scheduler and operational surface with no present
  need (YAGNI).

---

## D4 — Note storage shape: replace the singleton table with a per-user table

**Decision**: Drop the singleton `note (id INTEGER PRIMARY KEY CHECK (id = 1), text, …)` and define:

```sql
CREATE TABLE note (
  user_id     TEXT    PRIMARY KEY REFERENCES user(id),
  ciphertext  BLOB    NOT NULL,   -- nonce || ciphertext || GCM tag
  key_version INTEGER NOT NULL,   -- which keyring version protects this row
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX idx_note_key_version ON note(key_version);  -- fast "any notes on old version?"
```

**Rationale**:
- `user_id` as **primary key** enforces **one note per user** (FR-018) at the database level and ties
  every note to exactly one owner (FR-001), replacing the old `CHECK (id = 1)` singleton guarantee.
- The plaintext `text` column is removed entirely, so no plaintext path remains (FR-008).
- `key_version` enables decrypt-key selection (FR-010) and the index supports the rotation/retirement
  checks (FR-014) cheaply.

**Alternatives considered**:
- *Keep `id` PK + add `user_id UNIQUE`*: redundant — `user_id` is the natural key for a per-user
  singleton.
- *Separate `notes` collection table*: only needed for multiple-notes-per-user, rejected in clarify.

---

## D5 — Access isolation by construction (no per-request authorization branch)

**Decision**: The note routes derive the owner solely from `req.user.id` (set by the existing
`requireAuth` middleware from 002). `getNote(db, userId)` and `upsertNote(db, userId, …)` are scoped
by `user_id`; **no endpoint accepts a target user id**.

**Rationale**: Because there is no way to *address* another user's note, reading or updating someone
else's note is structurally impossible (FR-002–FR-005) — strictly safer than adding an ownership
`if`-check that could be forgotten on a new route. A non-owner simply reads/writes their own (possibly
empty) note. Tests still assert the property directly (two users → independent notes).

---

## D6 — Fail-closed behavior

**Decision**:
- **Startup**: `loadEnv` validates that `NOTE_ENC_ACTIVE_VERSION` exists in `NOTE_ENC_KEYS` and that
  every key decodes to 32 bytes; otherwise the process throws and refuses to start.
- **Read**: if a row's `key_version` is **not** in the keyring, or GCM auth-tag verification fails,
  `note-repo` throws; the route maps this to a `500 { error: "NOTE_DECRYPT_FAILED" }` (the
  established error envelope) and **never** returns plaintext or a partial result (FR-015).
- Decryption errors and key material are **never logged**.

**Rationale**: Encryption that silently degrades to plaintext (or serves garbage) would defeat the
purpose; failing closed makes a misconfigured/over-eager key retirement loud and safe rather than a
silent data exposure.

---

## D7 — Existing-data migration: none (pre-launch)

**Decision**: Per the spec assumption, the product is **pre-launch with no production note data**. The
`note` table is redefined; existing local/e2e SQLite files are disposable and recreated (delete the
dev DB / WAL files once). The test-reset seam clears all `note` rows. No data-migration code ships.

**Rationale**: Writing a one-shot plaintext→ciphertext backfill for data that does not exist would
violate YAGNI. The previously shared, unowned note is intentionally not carried to any user. (If real
data ever existed, a backfill would be a separate, explicit task.)

---

## D8 — No public contract shape change, no new dependency

**Decision**: `GET /api/note` and `PUT /api/note` keep their current request/response **shapes**
(`Note`, `NoteInput`, `NoteResponse`); only their *meaning* changes (now the caller's own note) plus a
new fail-closed error condition. `shared/src/api.ts` is **not** regenerated. The bulk re-encryption is
an **operator CLI**, not a public HTTP endpoint, so it adds no API surface. No runtime dependency is
added (Node `crypto` is built in).

**Rationale**: Keeps the change minimal and the client untouched (Principle II/IV). The contract docs
in `contracts/` describe the behavior delta and the operator command rather than duplicating the
unchanged OpenAPI file.

---

## Resolved unknowns summary

| Topic | Resolution |
|-------|------------|
| Cipher | AES-256-GCM, Node built-in `crypto`, `nonce‖ciphertext‖tag` BLOB (D1) |
| Key storage & versioning | Env keyring `NOTE_ENC_KEYS` + `NOTE_ENC_ACTIVE_VERSION`; per-row `key_version` (D2) |
| Rotation | Lazy on save + operator bulk CLI + retirement guard (D3) |
| Schema | `note` keyed by `user_id`; `ciphertext` BLOB + `key_version` (D4) |
| Isolation | Scoped to `req.user.id`; no target-user param (D5) |
| Failure mode | Fail closed at startup and on read; never log secrets/errors (D6) |
| Migration | None — pre-launch, no prod data (D7) |
| API/deps | Shapes unchanged, no regen, no new dependency; CLI not an endpoint (D8) |
