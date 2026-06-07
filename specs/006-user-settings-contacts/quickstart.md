# Quickstart: User Settings Page — Manage Contacts

**Feature**: 006-user-settings-contacts | **Date**: 2026-06-07

This feature adds no new env vars and no external services — the existing setup (Google OAuth client
+ JWT secret + note encryption keys from 001/002/004) is sufficient. The steps below assume that
baseline is already configured per the root `README.md`.

## Regenerate shared types (after editing the contract)

After adding the `/contact` paths and `Contact*` schemas to `contracts/openapi.yaml`:

```bash
npm run gen:api      # regenerates shared/src/api.ts from contracts/openapi.yaml
```

## Run locally

```bash
npm install
npm run gen:api
npm run dev:server   # API (Express) — e.g. http://localhost:3000
npm run dev:client   # SPA (Vite)    — e.g. http://localhost:5173
```

Sign in via Google, then open **/settings** (also reachable via the "Settings" link in the header).

## Manual verification (maps to acceptance scenarios)

1. **Empty state (US1)**: Open `/settings` as a fresh user → see "no contacts yet" empty state.
2. **Add (US2 #1)**: Enter `alice@example.com`, submit → it appears in the list; reload → still there.
3. **Original case (SC-009)**: Add `Bob@Example.com` → displayed with that exact case.
4. **Duplicate (US2 #3 / FR-008)**: Add `bob@example.com` → rejected as already existing; the first
   entry's casing is unchanged.
5. **Invalid (US2 #2 / FR-007)**: Add `not-an-email` → clear validation error, nothing saved.
6. **Cap (US2 #4 / FR-015)**: With 50 contacts, attempt a 51st → rejected with a clear message.
7. **Remove (US3)**: Remove a contact → it disappears; reload → it stays gone.
8. **Isolation (FR-003)**: Sign in as a second user → their list is independent of the first user's.

## Tests

```bash
npm run typecheck                                   # tsc across workspaces
npm test                                            # server + client unit/contract + hook tests
npm run test:e2e                                    # Playwright (incl. settings-contacts.spec.ts)

# Focused runs while developing:
npm run test --workspace server -- contact          # contact validation/repo/contract tests
npm run test --workspace client -- ContactList      # settings page / contact-list component tests
npx playwright test e2e/settings-contacts.spec.ts   # the contacts e2e flow
```

**Merge quality gates** (constitution): tests pass, `tsc` passes, and the new settings UI meets the
accessibility baseline (keyboard-navigable, semantic list, labeled input, ARIA status/alert).

## Rollback

Drop the `/settings` route and the `/api/contact` router mount; the `contact` table is additive and
can remain (unused) or be dropped — no other feature depends on it.
