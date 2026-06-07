# Quickstart: Per-User Note Ownership & Encryption at Rest

**Feature**: 004-note-ownership-encryption | **Date**: 2026-06-06

Covers the **new env** this feature needs, how to run/test it, and the **rotation runbook**. Google
SSO env from 002 (`GOOGLE_*`, `AUTH_JWT_SECRET`, optional `AUTH_TEST_MODE`) still applies.

## 1. Generate an encryption key

A key is 32 random bytes, base64-encoded:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 2. Configure the keyring (env)

```bash
# One known version to start. The value is the base64 from step 1.
export NOTE_ENC_KEYS="1:PASTE_BASE64_32B_KEY_HERE"
export NOTE_ENC_ACTIVE_VERSION="1"
```

- `NOTE_ENC_KEYS` — comma-separated `version:base64key` entries (all versions available to **decrypt**).
- `NOTE_ENC_ACTIVE_VERSION` — the version used to **encrypt** new/updated notes; MUST be one of the
  versions in `NOTE_ENC_KEYS`.
- The server **refuses to boot** if a key isn't 32 bytes or the active version is missing (fail closed).
- Keep keys out of source control; never log them.

## 3. Reset local DB (one-time, pre-launch)

The `note` table is redefined to be per-user. Since there is no production data, delete any existing
local/e2e SQLite files so the new schema is created fresh:

```bash
# adjust paths to your configured DB files
rm -f *.db *.db-wal *.db-shm e2e.db e2e.db-wal e2e.db-shm 2>/dev/null || true
```

## 4. Run

```bash
npm run dev:server     # validates env (incl. keyring) at startup, then listens
npm run dev:client     # unchanged; the note UI already calls GET/PUT /api/note
```

Sign in (Google, or the test-login seam when `AUTH_TEST_MODE=1`). Your note is now private to your
account: another account sees its own (initially empty) note, never yours.

## 5. Test

```bash
npm test               # unit + integration (cipher, keyring, repo, two-user isolation, fail-closed)
npm run test:e2e       # includes note-isolation.spec.ts (two test-login users see separate notes)
npm run typecheck
```

What to expect:
- Saving then reading returns the exact text (lossless round-trip).
- Inspecting the DB shows `ciphertext` (BLOB) and `key_version` — **no plaintext**.
- Two users have independent notes; neither can read the other's.

---

## Rotation runbook (introduce v2, retire v1)

Rotation is non-disruptive: add the new key, switch the active version, migrate, then retire the old.

1. **Generate** a new key (step 1) and **add** it alongside the old one, keeping the old for now:

   ```bash
   export NOTE_ENC_KEYS="1:OLD_BASE64,2:NEW_BASE64"
   export NOTE_ENC_ACTIVE_VERSION="2"     # new writes now use v2
   ```
   Restart the server. Existing v1 notes stay readable (v1 is still in the keyring); new/updated notes
   are written under v2 (**lazy** migration on every save).

2. **Force completion** with the operator bulk re-encryption so inactive users' notes also move to v2:

   ```bash
   npm run reencrypt --workspace server
   # => migrated=<n> remaining_by_version={ "2": <total> }   (no v1 remaining)
   ```

3. **Confirm** nothing depends on v1 (the report above shows `0` v1 rows, i.e. v1 absent from
   `remaining_by_version`).

4. **Retire** v1 only after the count is `0` — remove it from the env and restart:

   ```bash
   export NOTE_ENC_KEYS="2:NEW_BASE64"
   export NOTE_ENC_ACTIVE_VERSION="2"
   ```

> Safety: never remove a key version that still protects notes — those notes would become unreadable.
> Step 3's `0`-count check is the gate before step 4 (FR-014). If a key needed to read a note is ever
> missing, reads **fail closed** (error, never plaintext) rather than exposing data.
