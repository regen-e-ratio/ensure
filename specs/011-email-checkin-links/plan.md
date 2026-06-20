# Implementation Plan: Passwordless Email Check-In Links

**Branch**: `feat/deadman-switch` (feature `011-email-checkin-links`) | **Date**: 2026-06-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-email-checkin-links/spec.md`

## Summary

Let a user **stay alive from their inbox**. Extend feature 008's grace reminders so each one
(`enterGrace`'s first reminder and every `sendReminder` up to the cap) **mints a fresh one-time check-in
token**, persists **only its SHA-256 hash** in a new **`checkin_token`** table (`user_id`, `token_hash`
UNIQUE, `expires_at`, `used_at`, `created_at`; roadmap §3), and embeds the raw token exactly once in the
reminder email body as an **`APP_BASE_URL/checkin?token=<token>`** link. The token reuses feature 010's
shared **`server/src/deadman/tokens.ts`** (`mintToken`/`hashToken`/`compareToken`) — no new crypto.

A **public** (no-auth) **`GET /api/deadman/checkin?token=…`** route hashes the incoming token, looks the
`checkin_token` row up by hash, derives the user from that row (no session, no caller-supplied id), and —
only when the token is **valid, unused, and unexpired** and the switch is `active`/`grace` — performs the
check-in by **reusing `recordCheckin`** (reset `last_checkin_at`/`next_checkin_due_at`, state back to
`active`, clear `grace_deadline_at`/`reminders_sent`, record a `checkin` event), then marks the token
**used** (single-use) and returns a confirmation. An already-used/expired/unknown/malformed token — or a
token whose switch is `triggered`/`disarmed` — returns the **same generic not-available result** (the
latter still consuming the token so it can't be replayed), never resetting the clock. The route is mounted
**before** `requireAuth` (token-only authority, like the 009 verify route and the 010 release route).

The OpenAPI contract gains the public `GET /api/deadman/checkin` path + a `CheckinLinkResult` schema,
regenerated into `shared/src/api.ts`; the check-in token TTL lives in `shared/src/constants.ts`. The
client adds a public **`/checked-in`** confirmation page (clear "you're checked in" / "no longer
available" / generic-error states, accessible live region) registered **outside** `ProtectedRoute`, plus a
`checkinClient.ts`. This **reuses** feature 008's `recordCheckin`/`checkin` event and feature 010's token
helper; it adds **no** new env var, external service, or note-touching logic, and the reminder body still
carries no secret beyond the one-time link (FR-008/FR-017).

## Technical Context

**Language/Version**: TypeScript 5.6+ on Node.js 22 (server, run via `tsx`, ESM) and the browser SPA
(client); unchanged from 001/002/004/006/008/009/010.

**Primary Dependencies**: Express 5, Zod, better-sqlite3 (server); React 18 + React Router (client); the
existing `notify()` dispatcher + email channel (features 005/008); feature 010's hashed-token helper
(`deadman/tokens.ts`); feature 008's `recordCheckin` + `checkin` event. **No new runtime dependency** —
token mint is `node:crypto.randomBytes` (via the existing helper), the hash is SHA-256, and the link is
built from `APP_BASE_URL`. (KISS — reuse the engine's reminder send, the token helper, and the existing
check-in reset; no new module beyond the repo + endpoint + client page.)

**Storage**: Existing SQLite DB (better-sqlite3). **One new table** created in `openDb()`
(`server/src/db/index.ts`): `checkin_token` (`id`, `user_id`, `token_hash` UNIQUE, `expires_at`,
`used_at`, `created_at`) plus `idx_checkin_token_hash` on `token_hash` (roadmap §3). The check-in reset
reuses the existing `deadman_config` row and the `checkin` event — no new column, no note access. The raw
token and note plaintext are never persisted (only the token hash).

**Testing**: Vitest (server unit + contract via Supertest; client via React Testing Library) and
Playwright e2e — all already configured. New tests: checkin-token-repo unit (mint stores hash not raw
token, `findByTokenHash`, `markUsed` once → true/second → false, expiry boundary), engine-reminder unit
(entering grace + each subsequent reminder mints a fresh token and the captured reminder body contains
exactly one `APP_BASE_URL/checkin?token=<token>` link, no secret leaked; mint failure isolated per user),
contract tests for the public `GET /api/deadman/checkin` (valid → check-in + state `active` + `checkin`
event + token used; **second open → generic not-available, clock unchanged**; expired → not-available,
`used_at` unset; unknown/malformed → not-available; `triggered`/`disarmed` switch → not-available but
token consumed), client page tests (`/checked-in`: confirmation / no-longer-available / error), and a full
**e2e** cycle (arm → fast-forward miss → grace → capture reminder → open the embedded link → switch back
to `active`). **All server/e2e tests set `DEADMAN_TICK_DISABLED=1`** so the in-process timer never runs;
the engine is driven explicitly via `runDeadmanTick`/the fast-forward seam.

**Target Platform**: Linux server (single Node process) + existing browser SPA, single-instance deploy.

**Project Type**: Web application (existing npm workspaces `client/`, `server/`, `shared/`).

**Performance Goals**: The public check-in lookup is a single indexed read on `token_hash` (the
`idx_checkin_token_hash` index) plus the existing `recordCheckin` update — O(1) at this scale. The reminder
path adds one token insert per reminder for a user already being processed by the tick. No change to the
local p95 < 200 ms target for the synchronous endpoints.

**Constraints**:
- The check-in token reuses the **hashed-token** pattern via feature 010's `deadman/tokens.ts`: a
  high-entropy random value is shown **once** in the `/checkin?token=<token>` link; the DB stores **only**
  its SHA-256 hash; the open path hashes the incoming token and looks up by hash (FR-002). The raw token is
  never stored, logged, or serialized (FR-002, FR-014, SC-005).
- The token is **time-limited** (`expires_at`, `CHECKIN_TOKEN_TTL_SECONDS`, bounded so a link can't outlive
  its usefulness) and **single-use** (consumed when `used_at` is set) (FR-005, FR-010, SC-002).
- The public `GET /api/deadman/checkin` is **fail-closed** and **non-disclosing**: used/expired/unknown/
  malformed → the **same** generic not-available result, disclosing nothing about token/switch/user
  existence; it never resets the clock or records a `checkin` event on a failure path (FR-006, SC-003).
- A valid token whose switch is `triggered`/`disarmed` does **not** reset the clock but is **still
  consumed** (replay-proof) (FR-007, SC-006).
- The check-in reuses the existing **`recordCheckin`** reset + the existing **`checkin`** event — no new
  reset logic, no new event type (FR-004).
- The reminder body carries **no secret beyond the one-time link** (no note plaintext, no token hash),
  preserving feature 008's no-secrets reminder (FR-008, FR-014).
- A per-reminder mint failure is **isolated per user** (feature 008's batch isolation) and never aborts the
  tick (FR-009).
- Reminder emails go only through the generic **`notify()`** dispatcher (never a provider directly); the
  body carries a single `APP_BASE_URL/checkin?token=<token>` link (FR-001).
- The public route is mounted **before** `requireAuth` (token-only authority) (FR-003).
- The confirmation page is **text-labelled / accessible** (semantic heading + live region, no colour
  alone) and reachable without a session (FR-012, SC-007).

**Scale/Scope**: Small number of users, generous interval/grace. New: one table + one index; one repo; the
extended reminder send (mint + link) wired through the engine `Deps`; one public route; the reminder-email
body builder change; a `checkinClient.ts` + a public `/checked-in` page + route; OpenAPI additions + a
shared TTL constant; and tests at every layer.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|-----------|--------|----------------------------|
| I | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Tests written with/before code at every layer. **Unit (checkin-token-repo)** — minting stores the SHA-256 hash (never the raw token), `findByTokenHash` returns the row, `markUsed` consumes once (true → second call false), and the expiry boundary (`now >= expires_at`) is honoured. **Unit (engine reminder)** — `enterGrace` and each `sendReminder` mint a fresh token and the captured reminder body contains exactly one `APP_BASE_URL/checkin?token=<token>` link carrying no secret; a mint failure is isolated per user (the batch continues). **Contract (Supertest)** — public `GET /api/deadman/checkin?token=` checks in a `grace`/`active` switch (state `active`, `checkin` event, token used), returns a generic not-available on a **second** open (clock unchanged), on an expired token (`used_at` unset), on unknown/malformed tokens, and on a `triggered`/`disarmed` switch (token still consumed). **Client** — the `/checked-in` page renders the confirmation, the no-longer-available message, and a generic error. **e2e** — arm → fast-forward miss → grace → capture the reminder → open the embedded link → switch back to `active`. All wired into CI; merge blocked unless green. Every server/e2e test keeps `DEADMAN_TICK_DISABLED=1`. |
| II | Keep It Simple | ✅ PASS | Smallest design meeting the spec: the **one** table the roadmap §3 specifies (`checkin_token`) — no per-reminder link table, no scheduler change; **no new dependency** and **no new token module** (reuse feature 010's `deadman/tokens.ts`); **reuse** the existing `recordCheckin` reset + the existing `checkin` event (no new reset path, no new event type); **extend** the engine's existing reminder send rather than adding a parallel mailer; **one** public route + **one** client page. The TTL is a required shared constant, not speculative config. The mint capability is injected into the engine `Deps` (one closure) so the engine stays unit-testable with a spy — no new abstraction layer. → Complexity Tracking left empty. |
| III | Typed End to End | ✅ PASS | The `CheckinLinkResult` response and the public `GET /api/deadman/checkin` path are defined once in `contracts/openapi.yaml`, generated into `shared/src/api.ts` (`npm run gen:api`), and consumed by both client (`checkinClient.ts`, the `/checked-in` page) and server (the public check-in route via `components["schemas"]`). The `token` query param is validated with Zod returning the existing `ParseResult`-style union; the engine's reminder `Deps` gain a typed `mintCheckinLink(userId): string` member. `any` avoided; `tsc --noEmit` in CI. The check-in TTL is a typed shared constant. |
| IV | Accessible by Default | ✅ PASS | The public `/checked-in` page uses a semantic heading + landmark, an accessible live region (`role="status"`/`role="alert"`) announcing the **confirmed** vs **no-longer-available** vs **error** outcomes, relies on no colour alone, is keyboard-reachable, and is reachable without a session — mirroring `ContactVerifiedPage`/`ReleaseViewPage`. WCAG AA contrast inherited from existing styles plus any new check-in confirmation classes. |
| V | Small Pull Requests | ✅ PASS | Sliced into independently reviewable steps: **(1)** contract (the public `GET /deadman/checkin` path + `CheckinLinkResult`) + shared `CHECKIN_TOKEN_TTL_SECONDS` + the `checkin_token` table/index + the checkin-token repo + repo unit tests; **(2)** extend the engine reminder send (mint a token + embed the link via an injected `mintCheckinLink`) + engine reminder unit tests; **(3)** the public `GET /api/deadman/checkin` route (validate token → lookup → check-in via `recordCheckin` → mark used; generic not-available on every failure; consume-but-don't-reset on a non-checkable switch) + its contract tests + `app.ts` mount; **(4)** client `checkinClient.ts` + the public `/checked-in` page + route + client tests; **(5)** e2e cycle + README (Architecture/Tests) updates. Each is reviewable in one sitting and committed as its own bisectable `feat:` commit on the single feature branch (per roadmap §5). |

**Merge gates** (constitution Development Workflow): a PR merges only when (1) tests pass,
(2) `tsc` type-check passes, and (3) the new UI meets the accessibility baseline.

**Result**: PASS. No violations requiring justification → Complexity Tracking left empty.

**Post-design re-check (after Phase 1)**: Still PASS. The one table matches roadmap §3 exactly; the
check-in token reuses feature 010's hashed-token helper; the check-in reuses feature 008's `recordCheckin`
+ `checkin` event; the public route mirrors the 009/010 token-only routes; single-use + TTL + fail-closed
+ non-disclosure are enforced; the token whose switch is non-checkable is consumed but never resets the
clock. No note plaintext or token is ever persisted outside the existing artifacts (only the token hash).
All five principles remain satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/011-email-checkin-links/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification (+ Clarifications)
├── research.md          # Phase 0 output — decisions (token-helper reuse from 010, TTL choice + grace alignment, per-reminder mint, consume-but-don't-reset on non-checkable switch, fail-closed/non-disclosure)
├── data-model.md        # Phase 1 output — checkin_token table + token lifecycle (mint → used/expired)
├── quickstart.md        # Phase 1 output — miss a deadline, read the reminder link, open it, see the clock reset
├── contracts/
│   └── checkin-api.md   # Phase 1 — HTTP contract for the public GET /deadman/checkin
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root) — additions/changes to the existing layout

```text
contracts/openapi.yaml                  # ADD: public GET /deadman/checkin (no security; `token` query param)
                                        #      returning a CheckinLinkResult ({ status: "checked_in" |
                                        #      "not_available" }) with a generic not-available result on every
                                        #      failure path; mirror the contact-verify public route style

shared/src/
├── constants.ts                        # ADD: CHECKIN_TOKEN_TTL_SECONDS (bounded; aligned to the grace window)
├── index.ts                            # ADD: re-export CHECKIN_TOKEN_TTL_SECONDS
└── api.ts                              # REGENERATED via `npm run gen:api` from openapi.yaml (never hand-edited)

server/
├── src/
│   ├── app.ts                          # MOUNT: public GET /api/deadman/checkin via createCheckinRouter(db, { now })
│   │                                    #        BEFORE the requireAuth-gated /api/deadman mount (token-only authority,
│   │                                    #        like the 009 contact-verify and 010 release public routes)
│   ├── config/
│   │   └── env.ts                      # (REUSE) APP_BASE_URL/appBaseUrl already read (008); no new env var
│   ├── db/
│   │   ├── index.ts                    # ADD checkin_token table + idx_checkin_token_hash in openDb (roadmap §3),
│   │   │                                #      idempotently (CREATE TABLE/INDEX IF NOT EXISTS)
│   │   └── checkin-token-repo.ts       # NEW: createCheckinToken(db, userId, tokenHash, expiresAt, now),
│   │   │                                #      findByTokenHash(db, tokenHash) (→ userId + used_at + expires_at),
│   │   │                                #      markUsed(db, id, now) (single-use; sets used_at only when null),
│   │   │                                #      clearCheckinTokens(db) for the test-reset path — stores only the hash
│   │   ├── config-repo.ts              # ADD checkin_token wipe to clearDeadman (test-reset path); REUSE recordCheckin
│   │   │                                #      (the existing active/grace reset) and getConfig for the state guard
│   │   └── (note-repo.ts UNCHANGED)    # (no note access in this feature)
│   ├── deadman/
│   │   ├── tokens.ts                   # (REUSE feature 010) mintToken/hashToken/compareToken — no new token module
│   │   ├── engine.ts                   # EXTEND buildReminder/enterGrace/sendReminder: mint a fresh check-in token,
│   │   │                                #      persist its hash, and embed APP_BASE_URL/checkin?token=<token> in the
│   │   │                                #      reminder body via an injected mintCheckinLink(userId) (no secret leaked)
│   │   └── deps.ts                     # EXTEND Deps wiring: add mintCheckinLink(userId) — mint+hash+persist a token and
│   │   │                                #      return the absolute ${appBaseUrl}/checkin?token=<token> link (kept a
│   │   │                                #      closure so the engine stays unit-testable with a spy)
│   │   └── checkin-link.ts             # NEW (optional): buildCheckinLink(appBaseUrl, token) — single source of the URL
│   │   │                                #      shape, shared by deps.ts and any test assertions
│   ├── routes/
│   │   └── deadman-checkin.ts          # NEW PUBLIC router: GET /?token=… → parse token → hashToken →
│   │   │                                #      findByTokenHash → expiry/used guard → state guard (active/grace) →
│   │   │                                #      recordCheckin + recordEvent('checkin') → markUsed → { status:"checked_in" };
│   │   │                                #      every failure (used/expired/unknown/malformed/non-checkable) →
│   │   │                                #      { status:"not_available" } (consume the token on a non-checkable switch)
│   │   └── (deadman.ts UNCHANGED)      # the authed dashboard POST /checkin (feature 008) is untouched
│   └── validation/
│       └── checkin.ts                  # NEW: parse the `token` query param (presence/shape) for the public route
└── tests/
    ├── unit/                           # checkin-token-repo, engine-reminder-link (mint per reminder + link in body)
    └── contract/                       # deadman-checkin-public (checked_in / not_available paths)

client/
├── src/
│   ├── App.tsx                         # ADD a PUBLIC route /checked-in → <CheckedInPage/> (OUTSIDE ProtectedRoute)
│   ├── pages/
│   │   └── CheckedInPage.tsx           # NEW public page: read ?token, call the check-in client once (StrictMode guard),
│   │   │                                #      render confirmation / no-longer-available / error (a11y live region)
│   ├── api/
│   │   └── checkinClient.ts            # NEW: checkInWithToken(token) → "checked_in" | "not_available" via apiFetch
│   │   │                                #      (public route; no silent-refresh needed)
│   └── styles.css                      # ADD: check-in confirmation classes IF NEEDED (reuse verify-result styles
│   │                                    #      where possible; WCAG AA, text-labelled, not colour-only)
└── tests/
    └── pages/                          # CheckedInPage.test.tsx (confirmation / not-available / error)

e2e/
├── support/                            # (REUSE) loginAs, the capturing email provider, the DEADMAN_TEST_MODE seam
└── checkin-link.spec.ts               # NEW: arm → fast-forward miss → grace → read the captured reminder's
                                        #      /checkin?token link → open it → assert the dashboard shows `active` again

README.md                               # UPDATE Architecture (the checkin_token table, the reminder→link mint, the
                                        #   public GET /api/deadman/checkin one-time reset) and Tests (the new test files);
                                        #   Manual setup unchanged (no new env/service)
```

**Structure Decision**: Keep the existing web-app layout (npm workspaces `client/`, `server/`, `shared/`).
The feature **extends** the established dead-man vertical slice — table → repo → engine reminder → public
route on the server; OpenAPI → generated shared types; API module → page on the client — rather than adding
a parallel one. Check-in token state lives in the single roadmap-§3 table (`checkin_token`); the **public**
check-in route is a small separate router mounted **before** `requireAuth` (token-only authority, like the
009 contact-verify route and the 010 release route). The token mint/hash/compare reuse feature 010's
**shared** `deadman/tokens.ts`; the check-in itself reuses feature 008's `recordCheckin` + `checkin` event
(no new reset path, no new event type). Reminder emails go through the generic `notify()` dispatcher with an
`APP_BASE_URL/checkin?token=<token>` link. The new public confirmation page is registered **outside**
`ProtectedRoute` in `App.tsx`. Because this feature **adds one endpoint, one table, and a page** but
introduces **no new env var or external service** (it reuses `APP_BASE_URL`, the email channel, the token
helper, and `recordCheckin`), the README **Architecture** and **Tests** sections are updated in the same
commits, while **Run** and **Manual setup** are left unchanged (per CLAUDE.md README policy).

## Complexity Tracking

> No constitution violations — this section intentionally left empty. (The one table is exactly the one the
> roadmap §3 specifies; the check-in token reuses feature 010's existing SHA-256 hashed-token helper rather
> than a new token module; the check-in reuses feature 008's `recordCheckin` reset and `checkin` event
> rather than new reset logic or a new event type; the mint capability is a single injected closure on the
> engine `Deps` rather than a new abstraction; single-use + TTL + fail-closed + non-disclosure are simple
> guards, not a lock or queue. No note plaintext or token is ever persisted outside the token hash, and no
> provider is called outside the generic dispatcher.)
