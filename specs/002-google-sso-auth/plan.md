# Implementation Plan: Google SSO Authentication & Access Protection

**Branch**: `002-google-sso-auth` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-google-sso-auth/spec.md`

## Summary

Add **Google-only SSO** to the existing note app and **gate all access** behind it. Unauthenticated
visitors land on a new `/login` page; every other page and every `/api/note` request requires a
valid session. Sign-in uses the **server-side OAuth 2.0 Authorization Code + PKCE flow** with
Google (client secret stays on the server, via `google-auth-library`). On success the server mints
its **own session**: a stateless **~1h access-token JWT** (`jose`) plus an opaque, server-stored,
hashed **refresh token** with a **24h sliding inactivity** window — both delivered as httpOnly,
Secure, SameSite=Lax cookies. The client (now using `react-router-dom` with an `AuthProvider` and a
`ProtectedRoute` guard) performs **silent refresh** on `401`, so an active user is never
interrupted, while ≥24h of inactivity forces re-login.

**E2E concern (user-raised):** protecting the endpoints does make end-to-end tests harder, because
Google's consent screen cannot be reliably automated. The plan resolves this with an **env-gated
test-login seam** (`AUTH_TEST_MODE=1` → `POST /api/test/login`) that issues the *same* session
cookies as the real flow for a deterministic fake user — reusing the codebase's existing
`NOTE_ALLOW_TEST_RESET` / `POST /api/test/reset` pattern. The real authorization middleware, cookie
handling, and the protection redirect are all still exercised by E2E; only the Google identity hop
is stubbed (and that hop is covered by mocked server tests). See `research.md` D6.

## Technical Context

**Language/Version**: TypeScript 5.6+ on Node.js 22 LTS (server) and modern evergreen browsers
(client) — unchanged from `001-store-notes`.

**Primary Dependencies** (new in **bold**):
- Server: Express 5, Zod, better-sqlite3, **`google-auth-library`** (OAuth code exchange + ID-token
  verification), **`jose`** (sign/verify the access JWT), **`cookie-parser`** (read cookies).
- Client: React 18 + Vite 5, **`react-router-dom`** (routing + route-level protection).
- Shared: `openapi-typescript` regenerates `shared/src/api.ts` from the updated `contracts/openapi.yaml`.

**Storage**: Existing SQLite DB (better-sqlite3) extended with **`user`** and **`session`** tables
(see `data-model.md`). Access token is stateless (not stored). OAuth in-flight `state`/PKCE verifier
is a signed cookie, not a row.

**Testing**: Vitest (server unit + integration via Supertest; client components via React Testing
Library + jsdom) and Playwright e2e. Google is **mocked** in server tests; e2e uses the env-gated
`POST /api/test/login` seam and includes a no-seed spec asserting the protection redirect/401.

**Target Platform**: Linux server (Node process) + browser SPA, same-origin in dev and
single-instance deploy.

**Project Type**: Web application (existing `client/`, `server/`, `shared/` npm workspaces).

**Performance Goals**: Protected requests verify a JWT in-process (no DB hit on the hot path); DB is
touched only on sign-in/refresh/logout. Sign-in reachable in <30s excluding Google's own screens
(SC-003); local API p95 < 200 ms.

**Constraints**:
- Google is the **only** provider; any valid Google account is permitted (v1).
- Access token ~1h; silent refresh while active; **re-login after ~24h inactivity**.
- **No auth event logging / audit trail** in v1 (spec scope decision); additionally, tokens and
  secrets are never logged.
- Secrets via server env (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `AUTH_JWT_SECRET`); never sent to
  the client, never committed.

**Scale/Scope**: One shared note; small number of users; a handful of new auth endpoints, two new
tables, one new client page plus a route guard.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|-----------|--------|----------------------------|
| I | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Tests written before/with code at every layer: contract tests for the new `/auth/*` and now-protected `/note` (incl. 401 paths) against the OpenAPI contract; server unit tests for token mint/verify, refresh rotation, inactivity expiry, and Google verification (mocked); client component tests for `/login`, `ProtectedRoute`, and silent-refresh; Playwright e2e for sign-in (via the test-login seam), protected-redirect (no-seed), and sign-out. The **E2E-under-auth risk is explicitly designed for** (research.md D6) so the TDD gate stays satisfiable. All wired into CI; merge blocked unless green. |
| II | Keep It Simple | ✅ PASS (with notes) | Server-side Authorization Code flow with one official library; one `requireAuth` middleware; smallest schema (2 tables). **Notes / justified additions:** (a) the **two-token model** is required by the explicit spec policy (~1h access + silent refresh + 24h inactivity), not speculative; (b) **`react-router-dom`** is justified by a real present need — the app now has multiple pages plus deep-link protection and post-login return (FR-008/009/010); (c) the **test-login seam** reuses an already-accepted pattern in this repo. No speculative abstraction added → Complexity Tracking left empty. |
| III | Typed End to End | ✅ PASS | TypeScript both sides. New API shapes (`User`, auth responses, 401 `Error`) are added to `contracts/openapi.yaml` and regenerated into `shared/src/api.ts` via `openapi-typescript`, so client and server share one contract-derived source. `requireAuth` types `req.user`. `any` avoided; `tsc --noEmit` in CI. |
| IV | Accessible by Default | ✅ PASS | The `/login` page uses semantic HTML: a real, keyboard-operable "Sign in with Google" control with an accessible name and visible focus, sign-in errors announced via an `aria-live` region, WCAG AA contrast. Keyboard-only flow verified in component/e2e tests. |
| V | Small Pull Requests | ✅ PASS | Sliced by user story and layer: (1) contract + shared types + server session/token utilities + `requireAuth`; (2) US1 Google sign-in (start/callback) + provisioning; (3) US3 protect `/api/note` + 401 contract; (4) US2 client routing/`ProtectedRoute`/login page; (5) US4 logout + silent refresh; test-login seam lands with the first server slice. Each is independently mergeable. |

**Merge gates** (constitution Development Workflow): a PR merges only when (1) tests pass,
(2) `tsc` type-check passes, and (3) UI changes meet the accessibility baseline — all CI checks.

**Result**: PASS. No violations requiring justification → Complexity Tracking left empty.

**Post-design re-check (after Phase 1)**: Still PASS. The data model (`user`, `session`), the auth
contract, the OpenAPI-generated shared types, the single `requireAuth` middleware, and the
`AuthProvider`/`ProtectedRoute` pair add no abstraction beyond the justified items above. The
test-login seam is environment-gated and never present in production, mirroring the existing
test-reset route. All five principles remain satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/002-google-sso-auth/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — decisions D1–D8 (incl. E2E-under-auth)
├── data-model.md        # Phase 1 output — user + session tables
├── quickstart.md        # Phase 1 output — env setup, run, test
├── contracts/
│   └── openapi.yaml      # Phase 1 output — auth routes + protected /note + test-login
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root) — additions to the existing layout

```text
contracts/
└── openapi.yaml                  # MERGE auth additions in; then `npm run gen:api`

shared/
└── src/
    └── api.ts                    # REGENERATED — now includes User + auth/401 shapes

server/
├── src/
│   ├── app.ts                    # MOUNT cookie-parser, /api/auth router, requireAuth on /api/note;
│   │                             #   gate POST /api/test/login behind AUTH_TEST_MODE (like test reset)
│   ├── server.ts                 # validate new env vars at startup
│   ├── config/
│   │   └── env.ts                # NEW: typed, validated env (Google + JWT + AUTH_TEST_MODE)
│   ├── auth/
│   │   ├── routes.ts             # NEW: /auth/google/start, /callback, /me, /refresh, /logout
│   │   ├── google.ts             # NEW: google-auth-library wrapper (code exchange, verify ID token)
│   │   ├── tokens.ts             # NEW: access JWT sign/verify (jose); refresh token gen/hash/rotate
│   │   ├── cookies.ts            # NEW: set/clear access + refresh + handshake cookies
│   │   └── require-auth.ts       # NEW: Express middleware → 401 or req.user
│   ├── db/
│   │   ├── index.ts              # ADD: create user + session tables (alongside note)
│   │   ├── user-repo.ts          # NEW: upsertUser(googleProfile), getUser(id)
│   │   └── session-repo.ts       # NEW: createSession, findByTokenHash, rotate, deleteById, sweepExpired
│   └── test-support/
│       └── test-login.ts         # NEW: POST /api/test/login handler (mounted only when AUTH_TEST_MODE=1)
└── tests/
    ├── contract/                 # /auth/* and protected /note (200 + 401) vs openapi.yaml
    ├── integration/              # Supertest: sign-in (Google mocked), refresh rotation,
    │                             #   inactivity expiry, logout, requireAuth on /note
    └── unit/                     # tokens (sign/verify/exp), session rotation, env validation

client/
├── src/
│   ├── main.tsx                  # wrap app in <BrowserRouter> + <AuthProvider>
│   ├── App.tsx                   # routes: /login (public) + protected note route
│   ├── auth/
│   │   ├── AuthProvider.tsx      # NEW: context; loads GET /api/auth/me; exposes user + signOut
│   │   ├── ProtectedRoute.tsx    # NEW: redirect to /login?next=... when unauthenticated
│   │   └── useAuth.ts            # NEW: context hook
│   ├── pages/
│   │   └── LoginPage.tsx         # NEW: accessible "Sign in with Google" + error (aria-live)
│   ├── api/
│   │   └── http.ts               # NEW: fetch wrapper — on 401, POST /auth/refresh once then retry
│   └── api/noteClient.ts         # use the refresh-aware http wrapper
└── tests/
    └── components/               # LoginPage, ProtectedRoute, silent-refresh wrapper

e2e/
├── global-setup.ts               # unchanged (resets e2e.db)
├── auth.spec.ts                  # NEW: sign-in via POST /api/test/login → note loads; sign-out
├── auth-protection.spec.ts       # NEW: NO seed → "/" redirects to /login; GET /api/note → 401
├── note-save.spec.ts             # UPDATE: seed session (test-login) before driving the note UI
└── note-view.spec.ts             # UPDATE: same seeding

playwright.config.ts              # add AUTH_TEST_MODE: "1" to the server webServer env
```

**Structure Decision**: Keep the existing web-app layout (npm workspaces `client/`, `server/`,
`shared/`). Auth lives in a cohesive `server/src/auth/` module plus two new repos in `server/src/db/`;
the client gains a small `auth/` folder and a `pages/LoginPage`. The OpenAPI contract remains the
single source of truth for shared types. The test-login seam lives in `server/src/test-support/`
and is only mounted when `AUTH_TEST_MODE=1`, exactly mirroring the existing env-gated test-reset
route — so it never ships in production.

## Complexity Tracking

> No constitution violations — this section intentionally left empty. (The two-token session model,
> `react-router-dom`, and the test-login seam are each justified by a concrete present requirement in
> the Constitution Check above, so none constitutes unjustified complexity.)
