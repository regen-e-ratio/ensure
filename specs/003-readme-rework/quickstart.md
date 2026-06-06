# Quickstart: Performing & verifying the README rework

**Feature**: `003-readme-rework`

This is the implementer's guide for the rework itself (not end-user docs — those become the new
`README.md`). It explains how to produce the three artifacts and confirm they meet the spec.

## What you are producing

1. A rewritten **`README.md`** — header + Architecture + Run + Manual Setup + Tests, and nothing
   else (Contract A).
2. An additive **`CLAUDE.md`** rule — the README maintenance discipline, placed *outside* the
   `<!-- SPECKIT START/END -->` block.
3. A **`.githooks/pre-commit`** hook + activation + a unit test for its relevance classifier
   (Contract B).

## Step 1 — Rewrite README.md

Use the current code as the source of truth (research D1). The architecture section must cover:

- **Workspaces**: `shared/` (types generated from `contracts/openapi.yaml` via `npm run gen:api`),
  `server/` (Express 5 + Zod + better-sqlite3), `client/` (React 18 + Vite), `e2e/` (Playwright).
- **Request/auth flow**: SPA → `/api/*`; `requireAuth` gates `/api/note`; Google OAuth 2.0
  Authorization Code + PKCE → server-minted session (~1h access JWT via `jose` + opaque hashed
  refresh token, 24h sliding inactivity) in httpOnly/Secure/SameSite=Lax cookies; client silent
  refresh on 401.
- **Data store**: better-sqlite3, tables `note` (single row), `user`, `session`.
- **External services**: exactly one — the Google OAuth 2.0 Web client.

Delete everything else (deadman-switch vision, roadmap, scope in/out, the API table) — research D4.

## Step 2 — Run / Manual Setup / Tests sections

Pull exact commands from `package.json` and `server/.env.example`:

```bash
# Run
npm install
npm run gen:api          # contracts/openapi.yaml -> shared/src/api.ts
npm run dev:server       # http://localhost:3000  (API, SQLite at ./data/note.db)
npm run dev:client       # http://localhost:5173  (SPA, proxies /api -> :3000)

# Tests
npm test                 # server + client (Vitest / Supertest / RTL)
npm run typecheck        # tsc --noEmit across workspaces
npm run lint             # ESLint
npm run test:e2e         # Playwright   (PW_CHANNEL=chrome to use system Chrome)
```

Manual Setup must list (from `server/.env.example`): create a **Google OAuth 2.0 Web client**
(redirect URI `http://localhost:3000/api/auth/google/callback`), then create `server/.env` with
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and a generated `AUTH_JWT_SECRET`
(`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`). Document the
test-only `AUTH_TEST_MODE=1` / `NOTE_ALLOW_TEST_RESET=1` for e2e. **Never write real values.**

## Step 3 — CLAUDE.md rule

Append a `## README maintenance` section **after** `<!-- SPECKIT END -->`. State the four allowed
areas, the update-iff-relevant rule, the leave-alone rule, no-bloat/no-secrets, and the hook pointer.

## Step 4 — Pre-commit hook + test

```bash
# Activate (also wired via the package.json "prepare" script on npm install)
git config core.hooksPath .githooks
```

`.githooks/pre-commit` (POSIX sh): compute `git diff --cached --name-only`, match against the
relevance globs (data-model Entity 4); if matched and `README.md` is not staged, print a warning and
exit 1; otherwise exit 0. Keep the classifier as a pure unit and add a table-driven test wired into
`npm test` (research D6, Contract B).

## Verify (acceptance)

```bash
# README structure & onboarding (Contracts A; SC-001..SC-003, SC-005)
#  - headings map 1:1 to the 5 sections, nothing extra
#  - a clean checkout can run + `npm test` using ONLY the README
#  - all required env/secrets + Google client documented; no secret values present

npm test                 # includes the hook-relevance unit test (SC-007)

# Hook behavior (SC-007), manual two-case check:
#  a) edit server/src/<anything>, stage it, commit WITHOUT staging README  -> hook warns + blocks
#  b) edit only specs/** , stage, commit                                   -> commit proceeds silently
#  c) git commit --no-verify                                               -> always proceeds
```

## Done when

- README satisfies Contract A; CLAUDE.md carries the rule (SC-006); hook + test satisfy Contract B;
  `npm test` and `npm run typecheck` pass.
