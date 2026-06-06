# Contract: Operator Bulk Re-encryption Command

**Feature**: 004-note-ownership-encryption | **Date**: 2026-06-06

An **operator-run** command (not an HTTP endpoint) that migrates every note still sealed under a
non-active key version to the **active** version, so an old key can be safely retired (FR-013, FR-014).
It is part of the rotation runbook in `quickstart.md`.

## Invocation

```bash
# from repo root
npm run reencrypt --workspace server
# (script runs server/src/cli/reencrypt-notes.ts via tsx, reading the same env as the server)
```

Reads the same configuration as the server: the database path and the env keyring
(`NOTE_ENC_KEYS`, `NOTE_ENC_ACTIVE_VERSION`). It refuses to run if the keyring is invalid or the
active version is missing (same fail-closed validation as startup — FR-015).

## Behavior

1. Load the keyring and resolve the active version.
2. Select all `note` rows where `key_version ≠ activeVersion`.
3. For each: decrypt with `getKey(row.key_version)` → re-encrypt with the active key → update
   `ciphertext` and set `key_version = activeVersion`. (`created_at`/`updated_at` are **not** changed —
   this is a re-seal, not a content edit.)
4. Print a summary: number migrated, and a **per-version count of remaining rows** so the operator can
   confirm `0` notes remain on the version they intend to retire.

## Output (contract)

- Exit code `0` on success; non-zero if the keyring is invalid or a row cannot be decrypted (e.g. its
  key version is absent — surfaced loudly, never skipped silently → FR-015).
- Final line reports, e.g.: `migrated=3 remaining_by_version={ "2": 5 }` (here all notes now on v2).

## Retirement guard

A previous version may be removed from `NOTE_ENC_KEYS` **only** once its remaining count is `0`
(verifiable via `notesUsingVersion(version)` / this command's report). Removing a key that still
protects notes would make them permanently unreadable; the runbook requires the count check first
(FR-014).

## Tests (must pass)

- Seed notes under v1, set active=v2, run re-encryption → all rows have `key_version = 2` and still
  decrypt to their original plaintext (FR-005 of rotation: no data loss).
- `notesUsingVersion(1)` returns `0` after the run; `notesUsingVersion(2)` equals the note count.
- A row whose `key_version` is absent from the keyring causes a non-zero exit / loud error (not a
  silent skip).
- Timestamps (`created_at`, `updated_at`) are unchanged by a re-encryption pass.
