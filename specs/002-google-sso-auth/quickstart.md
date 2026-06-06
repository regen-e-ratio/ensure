# Quickstart: Google SSO Authentication & Access Protection

**Feature**: `002-google-sso-auth`

This adds Google sign-in and access protection to the existing note app. It builds on the
`client/` + `server/` + `shared/` npm-workspaces layout from `001-store-notes`.

## Prerequisites

- Node.js 22 LTS, repo dependencies installed (`npm install`).
- A **Google OAuth 2.0 Client** (type: Web application) from the Google Cloud Console, with an
  authorized redirect URI of `http://localhost:3000/api/auth/google/callback` for local dev.

## Environment variables (server)

Create `server/.env` (git-ignored) — never commit secrets:

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
AUTH_JWT_SECRET=<long-random-string>   # signs the ~1h access-token JWT
# AUTH_TEST_MODE=1                      # TEST ONLY — mounts POST /api/test/login; never in prod
```

The server validates these at startup and refuses to boot if a required one is missing (except
the test-only `AUTH_TEST_MODE`).

## Run it

```bash
npm run dev:server     # http://localhost:3000  (API)
npm run dev:client     # http://localhost:5173  (SPA)
```

1. Open `http://localhost:5173/` → you are redirected to `/login` (not authenticated).
2. Click **Sign in with Google** → Google consent → back to the note, now editable.
3. Reload within the hour → still signed in (silent refresh keeps you in for up to ~24h of
   inactivity).
4. Click **Sign out** → back to `/login`; the note is no longer reachable.

## Regenerate shared API types after contract changes

```bash
npm run gen:api        # contracts/openapi.yaml -> shared/src/api.ts
```

## Test

```bash
npm run test           # server + client unit/integration/contract (Vitest + Supertest + RTL)
npm run typecheck      # tsc --noEmit across workspaces
npm run test:e2e       # Playwright
```

### How E2E handles authentication (important)

The real Google consent screen is **never** automated. Instead, with `AUTH_TEST_MODE=1` the server
mounts `POST /api/test/login`, which issues the **same** session cookies as the real flow for a
deterministic fake user (this mirrors the existing `POST /api/test/reset` pattern). Playwright:

- **Authenticated specs**: call `POST /api/test/login` via the request context, reuse the cookies
  (`storageState`), then drive the note UI.
- **Protection spec**: seeds **nothing** and asserts that `/` redirects to `/login` and that a
  direct `GET /api/note` returns `401` — proving the gate is real.

The production Google path (start → callback → verify → mint session) is covered by server tests
with `google-auth-library` mocked. See `research.md` D6.

The Playwright `webServer` block gains `AUTH_TEST_MODE: "1"` (alongside the existing
`NOTE_ALLOW_TEST_RESET: "1"`) for the server process only.

## Manual accessibility check (login page)

- Tab to the "Sign in with Google" control and activate it with Enter/Space.
- Confirm a visible focus ring, a real `<button>`/`<a>` with an accessible name, and that the
  sign-in error message is announced via an `aria-live` region.
- Verify WCAG AA contrast on the login page text and control.
