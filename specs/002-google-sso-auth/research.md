# Phase 0 Research: Google SSO Authentication & Access Protection

**Feature**: `002-google-sso-auth` | **Date**: 2026-06-05

This document resolves the open technical questions for adding Google SSO to the existing
`client/` + `server/` + `shared/` note app. Each decision favors the **simplest option that
satisfies the spec** (Constitution II) and preserves **typed end-to-end** boundaries (III).

---

## D1. OAuth/OIDC flow with Google

**Decision**: Server-side **OAuth 2.0 Authorization Code flow with PKCE**, using Google as the
OIDC provider. The browser never holds the Google client secret. The "Sign in with Google" button
is a plain link to a server route (`GET /api/auth/google/start`) that 302-redirects to Google;
Google redirects back to `GET /api/auth/google/callback`, where the server exchanges the code,
verifies the ID token, provisions/looks up the user, and establishes the app session.

**Rationale**:
- Keeps the client secret server-side (the only place it is safe).
- The server is the trust boundary that mints our own session — clean place to enforce the
  ~1h token / 24h-inactivity policy independent of Google's token lifetimes.
- Authorization Code + PKCE is the current best-practice flow for web apps (implicit flow is
  deprecated).

**Alternatives considered**:
- *Google Identity Services (GIS) one-tap / ID-token-in-browser*: client gets a Google ID token
  directly and posts it to the server. Slightly fewer redirects but pushes more of the flow into
  the SPA and still needs a server step to mint our session; the redirect flow is simpler to reason
  about and to test. Rejected for v1.
- *Full Passport.js*: `passport` + `passport-google-oauth20` is a heavier abstraction than one
  provider warrants (YAGNI). Rejected.

**Library**: `google-auth-library` (official) for the code exchange and ID-token verification.

---

## D2. App session & token model (~1h access, silent refresh, 24h inactivity)

**Decision**: Two credentials, both delivered as **httpOnly, Secure, SameSite=Lax cookies**:
1. **Access token** — a stateless signed **JWT (~1h expiry)**. Sent automatically with same-origin
   requests; verified on every protected request. Not stored server-side.
2. **Refresh token** — an **opaque random string**, stored server-side **hashed** (SHA-256) in a
   `session` row with a **sliding 24h expiry**. Cookie path is scoped to the refresh endpoint.
   Each successful refresh slides the expiry forward 24h and rotates the token.

The client performs **silent refresh**: a fetch wrapper that, on a `401` from a protected call,
calls `POST /api/auth/refresh` exactly once and retries the original request. If refresh also
fails (refresh token expired/revoked after ≥24h inactivity), the user is routed to `/login`.

**Rationale**:
- Directly satisfies FR-016 (~1h access token), FR-017 / SC-007 (silent refresh while active),
  and FR-014 / SC-008 (re-login after ~24h inactivity). The two-token split is **required by these
  explicit spec requirements**, not speculative — so it is consistent with Keep It Simple.
- Stateless access JWT keeps the hot path (every protected request) free of DB lookups; the DB is
  touched only on refresh/logout.
- Hashed, rotating, server-stored refresh tokens make logout and inactivity expiry real (a stored
  token can be deleted/expired), and limit damage if a refresh cookie leaks.

**Library**: `jose` for signing/verifying the access JWT (modern, typed, ESM-native — fits the
repo's `"type": "module"`). `cookie-parser` to read cookies in Express.

**Alternatives considered**:
- *Single sliding-session cookie* (no separate access token): simpler, but cannot express the
  explicit "~1h access token" requirement and conflates the two lifetimes. Rejected.
- *Store the Google access/refresh tokens and call Google to validate*: couples every request to
  Google availability and exposes more surface than needed for a single shared note. Rejected.

---

## D3. CSRF / state handling during the OAuth handshake

**Decision**: Carry the OAuth `state` and PKCE `code_verifier` in a short-lived signed httpOnly
cookie set by `/start` and consumed by `/callback`. No DB table for the in-flight handshake.

**Rationale**: Avoids an extra table for a value that lives for seconds. SameSite=Lax + signed
cookie + `state` check covers CSRF on the callback. KISS.

**Alternatives considered**: an `oauth_state` DB table (more moving parts, needs cleanup job) —
rejected as unnecessary.

For the app's own protected mutations, same-origin + SameSite=Lax cookies plus the existing
JSON-only content type is sufficient for v1; no separate CSRF token is introduced (documented as
an assumption to revisit if cross-site embedding is ever needed).

---

## D4. Protecting the API endpoints

**Decision**: A single Express **`requireAuth` middleware** verifies the access-token JWT and
attaches `req.user`. Mount it on the protected routers (`/api/note`). Missing/invalid/expired
token → `401` with the existing `{ error, message }` Error shape (`error: "UNAUTHORIZED"`). The
auth routes (`/api/auth/*`) and static assets stay public.

**Rationale**: One middleware, one rejection shape, reuses the established error contract. Matches
FR-005/006/007.

---

## D5. Protecting the UI pages (client routing & guard)

**Decision**: Introduce **`react-router-dom`** with two routes: a public `/login` and the
protected note view (`/`). A `ProtectedRoute` wrapper redirects unauthenticated users to `/login`,
preserving the intended path (e.g. `?next=/`) so they return after sign-in. An `AuthProvider`
context exposes the current user (from `GET /api/auth/me`) and a loading state.

**Rationale**: The app now genuinely has **more than one page plus route-level protection**
(FR-008/009/010), which is the concrete present need that justifies adding a router — not
speculation. Without a router, deep-link protection and post-login return are hand-rolled and
error-prone.

**Alternatives considered**: ad-hoc conditional rendering in `App.tsx` (no router). Workable for
exactly two states but does not cleanly preserve the requested URL or scale to the redirect
semantics; rejected as more error-prone than a tiny router.

---

## D6. End-to-end testing under authentication (user-raised concern)

> **User input**: "making the endpoints protected will make the E2E test harder."

This is correct and is the main testing risk. Driving the **real** Google consent screen from
Playwright is brittle and effectively unsupported (Google actively blocks automation, requires
real credentials + MFA, and rate-limits). We must **not** automate Google in CI.

**Decision**: Add a **test-only authentication seam**, gated by an environment variable, mirroring
the project's existing `NOTE_ALLOW_TEST_RESET` → `POST /api/test/reset` pattern:

- When `AUTH_TEST_MODE=1`, the app mounts `POST /api/test/login` which **mints a real app session
  (the same access + refresh cookies as the production flow) for a deterministic fake user**,
  *without ever contacting Google*. It is never mounted in production (same guard style as the
  existing test-reset route, which `app.ts` already gates behind `enableTestReset`).
- Playwright obtains a session by calling `POST /api/test/login` via the request context and
  reuses the resulting cookies (Playwright `storageState`) for authenticated specs. The real
  Google flow is exercised by **contract/unit tests with the Google client mocked**, not by E2E.
- **Protection itself is still E2E-tested**: one spec performs **no** seeding and asserts that
  visiting `/` redirects to `/login` and that a direct API call returns `401` — proving the gate
  works. Another seeds a session and asserts the note loads and saves.

**Why this is honest, not a bypass of the requirement**: the production code path (Google →
verify → mint session) is unchanged and is covered by mocked server tests; the test-login route
issues sessions through the **same** minting code, so E2E exercises the real authorization
middleware and cookie handling. Only the identity-provider hop is stubbed.

**Rationale**: Satisfies the TDD gate (Constitution I) for the protected flows while keeping E2E
fast and deterministic. Reuses an already-accepted pattern in this codebase, so it adds no new
concept for reviewers.

**Alternatives considered**:
- *Run a mock OIDC server* (e.g. `oauth2-mock-server`) so the full redirect flow runs against a
  fake Google: higher fidelity but adds a dependency and a second server to orchestrate in CI.
  Kept as a **possible later upgrade**; the env-gated test-login seam is simpler for v1.
- *Inject a signed JWT cookie directly in the test* without any server route: works for access but
  skips refresh-token issuance and drifts from the real cookie set. The test-login route keeps
  tests aligned with the real session shape. Rejected in favor of the route.
- *Store Google service-account credentials in CI and automate consent*: brittle, insecure,
  against Google ToS. Rejected.

---

## D7. Data persistence for auth

**Decision**: Extend the existing SQLite database (better-sqlite3) with two tables: `user` and
`session` (see `data-model.md`). The access token is stateless (not stored). The in-flight OAuth
state is a cookie, not a row (D3).

**Rationale**: Reuses the existing storage driver and migration approach (`server/src/db/index.ts`
already creates the `note` table) — no new storage technology. Smallest schema that supports
auto-provisioning (FR/Assumption), refresh, logout, and inactivity expiry.

---

## D8. Configuration & secrets

**Decision**: New server environment variables, read at startup and validated:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `AUTH_JWT_SECRET`
(for signing the access JWT), and the test-only `AUTH_TEST_MODE`. Secrets are never sent to the
client and never logged (consistent with the "no auth event logging" scope decision — and we
additionally never log tokens/secrets).

**Rationale**: Twelve-factor config; keeps secrets out of source and out of the typed client
bundle.

---

## Resolved unknowns summary

| Topic | Resolution |
|-------|------------|
| OAuth flow | Server-side Authorization Code + PKCE via `google-auth-library` (D1) |
| Session model | 1h access JWT (`jose`) + opaque hashed refresh token, 24h sliding (D2) |
| Silent refresh | Client retries once via `POST /api/auth/refresh` on 401 (D2) |
| CSRF/state | Signed httpOnly cookie holds `state`+PKCE verifier (D3) |
| API protection | Single `requireAuth` middleware → 401 with existing Error shape (D4) |
| UI protection | `react-router-dom` + `ProtectedRoute` + `AuthProvider` (D5) |
| **E2E under auth** | **Env-gated `POST /api/test/login` test seam + real-gate redirect spec (D6)** |
| Storage | `user` + `session` tables in existing SQLite DB (D7) |
| Config/secrets | Google + JWT env vars, validated at startup (D8) |

No `NEEDS CLARIFICATION` markers remain.
