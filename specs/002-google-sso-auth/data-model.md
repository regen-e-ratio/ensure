# Phase 1 Data Model: Google SSO Authentication & Access Protection

**Feature**: `002-google-sso-auth` | **Date**: 2026-06-05

Extends the existing SQLite database (`server/src/db/index.ts`, better-sqlite3). The existing
single-row `note` table is unchanged in shape; it is now reachable only through the `requireAuth`
middleware. Two new tables are added. The **access token is stateless** (a signed JWT) and is
therefore **not** stored.

---

## Entities

### `user`

A person who has signed in with Google. Auto-provisioned on first successful sign-in
(Assumption: no separate registration). Identified by Google's stable subject identifier.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Google `sub` claim — stable, unique per Google account |
| `email` | TEXT | NOT NULL | From the verified ID token; used for display |
| `name` | TEXT | NULL | Optional display name from the ID token |
| `created_at` | TEXT | NOT NULL | ISO-8601 UTC; first sign-in time |
| `last_login_at` | TEXT | NOT NULL | ISO-8601 UTC; updated on each successful sign-in |

- **Identity/uniqueness**: `id` (Google `sub`) is the primary key. Email is **not** the key (a
  Google account's email can change; `sub` does not).
- **Lifecycle**: created on first sign-in; `last_login_at` updated on subsequent sign-ins. No
  deletion flow in v1.
- **Privacy**: no password is ever stored; only the minimum identity needed to recognize the user.

### `session` (refresh token)

A server-side record backing one refresh token, enabling silent refresh, real logout, and the
~24h inactivity expiry.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | Random opaque session id |
| `user_id` | TEXT | NOT NULL, FK → `user.id` | Owner of the session |
| `token_hash` | TEXT | NOT NULL, UNIQUE | SHA-256 of the opaque refresh token (raw token never stored) |
| `expires_at` | TEXT | NOT NULL | ISO-8601 UTC; **sliding** — set to `now + 24h` on issue and on each refresh |
| `created_at` | TEXT | NOT NULL | ISO-8601 UTC |
| `last_used_at` | TEXT | NOT NULL | ISO-8601 UTC; updated on each refresh |

- **State transitions**:
  - *Issued* on sign-in (`expires_at = now + 24h`).
  - *Refreshed*: on `POST /api/auth/refresh`, if not expired, the token is **rotated** (new
    `token_hash`), `expires_at` and `last_used_at` slide forward; a fresh ~1h access JWT is issued.
  - *Expired*: `expires_at < now` (≥24h since last use) → refresh rejected; row may be deleted.
  - *Revoked*: deleted on `POST /api/auth/logout`.
- **Validation**: refresh succeeds only if a row matches `token_hash` **and** `expires_at > now`.
- **Cleanup**: expired rows are deleted lazily on access and/or by a tiny startup sweep (no cron).

> The **access token** is a stateless JWT — `{ sub: user.id, email, iat, exp(~1h) }`, signed with
> `AUTH_JWT_SECRET`. It is verified on every protected request and never persisted.

---

## Relationships

```text
user (1) ────< (N) session
  id  ◄─────────  user_id
```

A user may have multiple concurrent sessions (e.g. two devices); each is an independent `session`
row. Logout deletes the current session only.

---

## Validation rules (from spec requirements)

- **FR-003 / Assumption**: on first sign-in, insert a `user` row keyed by Google `sub`; on repeat
  sign-in, update `last_login_at`.
- **FR-004 / FR-016**: every sign-in issues an access JWT with ~1h `exp`.
- **FR-017 / SC-007**: refresh rotates the session and re-issues the access JWT while
  `session.expires_at > now`.
- **FR-014 / SC-008**: once `session.expires_at <= now` (≥24h inactivity), refresh fails and the
  user must sign in again.
- **FR-012 / SC-006**: logout deletes the `session` row and clears both cookies.
- **FR-006**: a tampered/expired access JWT fails signature/expiry verification → 401.

---

## Migration notes

- Add `CREATE TABLE IF NOT EXISTS user (...)` and `CREATE TABLE IF NOT EXISTS session (...)`
  alongside the existing `note` table creation in `server/src/db/index.ts`.
- Add an index on `session(token_hash)` (already UNIQUE) and `session(user_id)`.
- No change to the `note` table schema. Existing note tests remain valid once they present a valid
  (test-mode) session.
