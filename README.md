# Ensure

A small full-stack web app where each signed-in user keeps **one private note, encrypted at rest**,
gated behind Google sign-in. (Foundation for a future "deadman switch" application.)

> **Maintaining this README:** keep it to the four sections below — Architecture, Run, Manual setup,
> Tests — and update it only when a change actually affects one of them. See the "README
> maintenance" rule in [`CLAUDE.md`](CLAUDE.md); a `.githooks/pre-commit` hook reminds you.

## Architecture

A TypeScript monorepo using npm workspaces. One external service: **Google OAuth 2.0**.

### Workspaces

| Workspace        | Responsibility |
|------------------|----------------|
| **`shared/`**    | Types shared across the stack. `src/api.ts` is **generated** from `contracts/openapi.yaml` by `openapi-typescript` (`npm run gen:api`); `src/constants.ts` holds shared values (e.g. `NOTE_MAX_LENGTH`, `CONTACT_MAX_LENGTH`, `CONTACT_LIMIT`). |
| **`server/`**    | Express 5 API (ESM, run via `tsx`). Zod request validation, `better-sqlite3` storage, Google SSO. |
| **`client/`**    | React 18 SPA built with Vite 5 and `react-router-dom`. |
| **`e2e/`**       | Playwright acceptance tests. |
| **`contracts/`** | `openapi.yaml` — the API contract and **source of truth** for `shared/src/api.ts`. |

### Request & authentication flow

The SPA (`:5173`) calls the API under `/api/*` (Vite proxies to the server on `:3000` in dev).

- **`/api/auth/*`** (public) — sign-in and session lifecycle: `GET /google/start`,
  `GET /google/callback`, `GET /me`, `POST /refresh`, `POST /logout`.
- **`/api/note`** (protected by the `requireAuth` middleware) — scoped to the caller (`req.user.id`),
  so no endpoint can address another user's note. `GET` returns the caller's own note (decrypted) or
  `null`; `PUT` upserts it (encrypting with the active key version). Text must be non-empty (trimmed)
  and at most `NOTE_MAX_LENGTH` characters, else `400`. Requests without a valid session get `401`. If
  a stored note cannot be decrypted, `GET` **fails closed** with `500 NOTE_DECRYPT_FAILED` — never
  plaintext.
- **`/api/contact`** (protected by `requireAuth`) — the user's contact list, scoped to the caller, so
  no endpoint can address another user's contacts. `GET` lists them; `POST` adds one (only
  `type: "email"` this release; the stored value preserves original case while duplicates are detected
  case-insensitively); `DELETE /:id` removes one (idempotent). Adds are rejected for a malformed/too-long
  email (`400`), a duplicate (`409 DUPLICATE_CONTACT`), or exceeding `CONTACT_LIMIT` (`409
  CONTACT_LIMIT_REACHED`). The SPA surfaces this at the protected **`/settings`** page.

**Sign-in** uses the server-side **OAuth 2.0 Authorization Code + PKCE** flow with Google
(`google-auth-library`); the client secret never leaves the server. On success the server mints its
**own session**:

- a stateless **~1h access-token JWT** (`jose`), verified in-process on every protected request (no
  DB hit on the hot path); and
- an opaque, server-stored, **hashed refresh token** with a **24h sliding inactivity** window.

Both are delivered as **httpOnly, Secure, SameSite=Lax** cookies (Secure is relaxed only in test
mode, which runs over plain HTTP). The client's fetch wrapper performs a **silent refresh** on `401`
then retries, so an active user is never interrupted; ≥24h of inactivity forces re-login. On the
client, an `AuthProvider` loads `GET /api/auth/me` and a `ProtectedRoute` redirects unauthenticated
visitors to `/login`.

### Data store

`better-sqlite3` (WAL, foreign keys on) at `./data/note.db` (`NOTE_DB_PATH`). Four tables:

- **`note`** — one row per owner, keyed by `user_id` (PRIMARY KEY → at most one note per user).
  Content is stored as `ciphertext` (BLOB) with the `key_version` that protects it (indexed) plus
  `created_at`/`updated_at` — there is no plaintext column.
- **`user`** — provisioned from the Google profile (`id`, `email`, `name`, timestamps).
- **`session`** — backs the refresh token (`token_hash` unique, `expires_at`, `last_used_at`).
- **`contact`** — a user's contacts (`id` PK, `user_id` FK, indexed). Carries an explicit `type`
  (`email` today; the column exists so future types need no migration), the `value` (original case)
  and a derived `value_norm` with `UNIQUE(user_id, type, value_norm)` for case-insensitive
  de-duplication, plus `created_at`. Stored as plaintext (no encryption requirement).

### Encryption at rest

Note content is sealed with **AES-256-GCM** using Node's built-in `crypto` (no new dependency) in
`server/src/crypto/` — a versioned **keyring** (`keyring.ts`) plus the cipher (`note-cipher.ts`). The
keyring comes from env (`NOTE_ENC_KEYS` + `NOTE_ENC_ACTIVE_VERSION`), never the database: new/updated
notes use the active version; any present version can decrypt; an unknown version or failed auth tag
**fails closed**. Rotation is non-disruptive — add a new version and point the active version at it
(new saves migrate lazily), then run the operator CLI `npm run reencrypt --workspace server` to
re-encrypt every remaining note so the old version can be retired once no note depends on it.

### Test seams (never in production)

Mounted only when their env gate is set: `POST /api/test/login` (`AUTH_TEST_MODE=1`) mints a real
session for a fake user without contacting Google, and `POST /api/test/reset`
(`NOTE_ALLOW_TEST_RESET=1`) clears the note and contacts. These let Playwright exercise the real middleware and
cookies while skipping Google's non-automatable consent screen.

## Run

Requires **Node.js 22 LTS** (`node -v`). Complete [Manual setup](#manual-setup) first (the server
refuses to boot without valid Google/JWT config and a valid encryption keyring).

```bash
npm install
npm run gen:api        # contracts/openapi.yaml -> shared/src/api.ts
npm run dev:server     # Express API on http://localhost:3000  (SQLite at ./data/note.db)
npm run dev:client     # Vite SPA on  http://localhost:5173    (proxies /api -> :3000)
```

Open <http://localhost:5173> → you are redirected to `/login` → **Sign in with Google** → the note
loads and is editable. It persists across reloads and server restarts; **Sign out** returns you to
`/login`.

## Manual setup

Two things cannot be derived from `npm install` and must be done by hand.

### 1. Create a Google OAuth 2.0 client

In the [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services →
Credentials**, create an **OAuth client ID** of type **Web application**. Add this **Authorized
redirect URI** (must match `GOOGLE_REDIRECT_URI` exactly):

```text
http://localhost:3000/api/auth/google/callback
```

Copy the generated **Client ID** and **Client secret** for the next step.

### 2. Create `server/.env`

The server reads `server/.env` (git-ignored — **never commit secrets**); see
[`server/.env.example`](server/.env.example). Required variables (the process won't boot if any is
missing or malformed):

| Variable               | Purpose |
|------------------------|---------|
| `GOOGLE_CLIENT_ID`     | OAuth Web client ID from step 1. |
| `GOOGLE_CLIENT_SECRET` | OAuth Web client secret from step 1 (stays server-side). |
| `GOOGLE_REDIRECT_URI`  | `http://localhost:3000/api/auth/google/callback` (must match the Google client). |
| `AUTH_JWT_SECRET`      | ≥16-char random string that signs the access-token JWT. Generate one: |

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 3. Configure the encryption keyring

The note content is encrypted at rest, so the server also needs an encryption keyring in
`server/.env` (the process won't boot without a valid active key — fail closed):

| Variable                  | Purpose |
|---------------------------|---------|
| `NOTE_ENC_KEYS`           | Comma-separated `version:base64key` entries — all versions available to **decrypt** (e.g. `1:<b64>,2:<b64>`). Each key must decode to exactly 32 bytes. |
| `NOTE_ENC_ACTIVE_VERSION` | The version used to **encrypt** new/updated notes; must be one of the versions in `NOTE_ENC_KEYS`. |

Generate a 32-byte key (base64) for each version:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

To rotate, add a new version, point `NOTE_ENC_ACTIVE_VERSION` at it, run
`npm run reencrypt --workspace server`, then retire the old version once no note still uses it.

**Test-only** (optional; never enable in production): `AUTH_TEST_MODE=1` mounts the test-login seam
and `NOTE_ALLOW_TEST_RESET=1` mounts the reset route. The e2e suite sets these (and dummy Google/JWT
values **and a test keyring**) itself — see [`playwright.config.ts`](playwright.config.ts) — so you
do **not** need real Google credentials or keys to run e2e.

## Tests

```bash
npm test            # server + client unit/integration/contract tests (Vitest, Supertest, RTL)
npm run typecheck   # tsc --noEmit across all workspaces
npm run lint        # ESLint
npm run test:e2e    # Playwright acceptance tests (starts the server + client automatically)
```

Where Playwright's bundled Chromium is unavailable, drive system Chrome instead:

```bash
PW_CHANNEL=chrome npm run test:e2e
```

In CI, install the browser normally (`npx playwright install --with-deps chromium`) and run without
`PW_CHANNEL`.

**Merge gates** ([constitution](.specify/memory/constitution.md)): a change merges only when tests
and e2e pass, `typecheck` passes, and UI changes meet the accessibility baseline (semantic HTML,
labelled controls, keyboard navigation, WCAG AA contrast).
