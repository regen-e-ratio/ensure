# Implementation Plan: Release & Secure One-Time Delivery

**Branch**: `feat/deadman-switch` (feature `010-release-delivery`) | **Date**: 2026-06-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-release-delivery/spec.md`

## Summary

Turn a fired switch into a **secure, one-time delivery** of the owner's note to their **verified**
contacts. Extend the engine's existing `triggered` transition (today just `setState('triggered')` +
`recordEvent('triggered')` in `server/src/deadman/engine.ts`) so that, on grace-expiry, it: creates a
**`release`** row, snapshots **only verified contacts** (`verified_at != null`), mints **one high-entropy
grant token per contact**, persists a **`release_grant`** per contact (storing only the token's SHA-256
hash + a future `expires_at`), emails each contact a single `APP_BASE_URL/r/<token>` link via the generic
**`notify()`** dispatcher, records per-grant **`email_status`** (`pending`→`sent`|`failed`), transitions
the switch to **`triggered`**, and records **`triggered`** + a new **`released`** event (non-sensitive
metadata only). Release creation is **idempotent**, guarded on switch **state + an existing-release
check**, so the in-process 60 s timer and an external cron can never double-fire.

A **public** (no-auth) **`GET /api/release/{token}`** route hashes the incoming token, looks the grant up
by hash, and — only when valid, unviewed, and unexpired — decrypts the owner's note server-side via the
**keyring**, sets `viewed_at` (view-once), and returns the note text **once**. Already-viewed/expired →
**`410 Gone`**; unknown/malformed → a generic not-available result; a decrypt failure **fails closed**
with **`500`** and never sets `viewed_at` or leaks plaintext. The route is **rate-limited**. An authed
**`POST /api/deadman/test-release`** mints a grant to the owner's **own verified address** (release tagged
`manual_test`) and emails it **without changing switch state**, so a user can preview the recipient
experience (the CTA feature 012 integrates).

The grant token reuses the existing **SHA-256 hashed-token** pattern via a new shared
**`server/src/deadman/tokens.ts`** (`mintToken`/`hashToken`/`compare`), shared with feature 011's
check-in tokens. The OpenAPI contract gains the two paths, a release-view response schema, and a
`released` value on the `DeadmanEvent` type enum; it is regenerated into `shared/src/api.ts`, with the
grant-token TTL in `shared/src/constants.ts`. The client adds a public **`/r/:token`** view-once page
(prominent "can only be opened once" warning, renders the note text, clear "no longer available"
fallback) registered **outside** `ProtectedRoute`, plus a `releaseClient.ts` and a `testRelease()` call
in `deadmanClient.ts`. This consumes feature 009's verified flag and feature 004's keyring; it performs
no verification and adds no new crypto, env var, or external service.

## Technical Context

**Language/Version**: TypeScript 5.6+ on Node.js 22 (server, run via `tsx`, ESM) and the browser SPA
(client); unchanged from 001/002/004/006/008/009.

**Primary Dependencies**: Express 5, Zod, better-sqlite3 (server); React 18 + React Router (client); the
existing `notify()` dispatcher + email channel (feature 005); the versioned keyring + `note-cipher`
(feature 004); the hashed-token helpers (`auth/tokens.ts`, `contacts/verification-token.ts`). **No new
runtime dependency** — token mint is `node:crypto.randomBytes`, the hash is SHA-256 (`createHash`), the
link is built from `APP_BASE_URL`, and rate-limiting is a tiny in-process fixed-window counter (no
library). (KISS — reuse the session/verification token pattern; no job queue, no rate-limit dependency.)

**Storage**: Existing SQLite DB (better-sqlite3). **Two new tables** created in `openDb()`
(`server/src/db/index.ts`): `release` (`id`, `user_id`, `trigger`, `created_at`) and `release_grant`
(`id`, `release_id`, `user_id`, `contact_id`, `token_hash` UNIQUE, `expires_at`, `viewed_at`,
`email_status`, `provider_message_id`, `email_error`, `created_at`), plus
`idx_release_grant_token` on `token_hash` (per roadmap §3). The note decrypt on open reuses the existing
`note` table + keyring — the raw grant token and note plaintext are never persisted (only the hash and
the existing ciphertext).

**Testing**: Vitest (server unit + contract via Supertest; client via React Testing Library) and
Playwright e2e — all already configured. New tests: token-helper unit (mint entropy, hash determinism,
constant-time compare), release-repo unit (createRelease, createGrants for verified only,
getGrantByTokenHash, markGrantViewed once, set email status, existing-release/idempotency guard), engine
unit (trigger → release+grants+emails via spy notifier, idempotent re-tick creates no second release,
verified-only snapshot, per-grant email failure recorded), contract tests for the public
`GET /api/release/{token}` (success once; 410 on second/expired; 404/410 unknown; **decrypt-fail → 500,
viewed_at unset**; rate-limit) and the authed `POST /api/deadman/test-release` (manual_test release, state
unchanged, 401 unauth, no-verified-contact error), client page tests (`/r/:token`: note + warning;
no-longer-available; error), and a full **e2e** cycle (arm → fast-forward miss → grace → trigger → open
link once → gone). **All server/e2e tests set `DEADMAN_TICK_DISABLED=1`** so the in-process timer never
runs; the engine is driven explicitly via `runDeadmanTick`/the fast-forward seam.

**Target Platform**: Linux server (single Node process) + existing browser SPA, single-instance deploy.

**Project Type**: Web application (existing npm workspaces `client/`, `server/`, `shared/`).

**Performance Goals**: The public release lookup is a single indexed read on `token_hash` (the
`idx_release_grant_token` index) plus one keyring decrypt — O(1) at this scale. The trigger path is one
release insert + N grant inserts/emails for a user's (small) verified-contact set. No change to the local
p95 < 200 ms target for the synchronous endpoints.

**Constraints**:
- The grant token reuses the **hashed-token** pattern: a high-entropy random value is shown **once** in
  the `/r/<token>` link; the DB stores **only** its SHA-256 hash; the open path hashes the incoming token
  and looks up by hash (FR-012). The raw token is never stored, logged, or serialized (FR-002, FR-012,
  SC-008).
- The grant is **time-limited** (`expires_at`, default 30 days) and **single-use** (consumed when
  `viewed_at` is set, view-once) (FR-008, SC-004).
- The public `GET /api/release/{token}` is **fail-closed** and **non-disclosing**: already-viewed/expired
  → `410 Gone`, unknown/malformed → generic not-available, decrypt failure → `500` with no plaintext and
  `viewed_at` left **unset** (FR-009, FR-010, SC-005, SC-006), and is **rate-limited** (FR-011).
- The note is decrypted **server-side only** via the keyring, only on a valid open, and the plaintext is
  materialized in memory then discarded — never persisted outside `note.ciphertext`, never logged, never
  in an event (FR-008, FR-017, SC-008).
- Release creation is **idempotent**, guarded on switch state (`triggered`) **plus** an existing-release
  check so the timer + an external cron never double-release (FR-005, SC-002).
- Only **verified** contacts (`verified_at != null`) are snapshotted; unverified contacts get no grant
  (FR-001, SC-003).
- Emails go only through the generic **`notify()`** dispatcher (never a provider directly); the body
  carries a single `APP_BASE_URL/r/<token>` link and no plaintext (FR-002).
- The **test-release** endpoint is authed + scoped by `req.user.id`, sends only to the caller's own
  verified address(es), and **never changes switch state** (FR-013, FR-014, SC-007).
- The view-once page is **text-labelled / accessible** (semantic heading + live region, no colour alone)
  and reachable without a session (FR-016, SC-009).

**Scale/Scope**: Small number of users, ≤ 50 contacts each. New: two tables + one index; a shared token
helper; a release repo; the extended engine trigger; one public route (rate-limited) + one authed route;
the release email builder; a `releaseClient.ts` + `testRelease()` client call; a public view-once page +
route; OpenAPI additions + a shared TTL constant; and tests at every layer.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|-----------|--------|----------------------------|
| I | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Tests written with/before code at every layer. **Unit (tokens)** — `mintToken` is high-entropy, `hashToken` is deterministic SHA-256, `compare` is constant-time; the raw token never round-trips through storage. **Unit (release-repo)** — `createRelease`, `createGrants` (verified-only), `getGrantByTokenHash`, `markGrantViewed` (once → returns the grant, second call → already-viewed), set-email-status, and the existing-release/idempotency guard. **Unit (engine)** — trigger creates one release + one grant per verified contact, emails via a **spy notifier**, records `triggered`+`released`; a **re-tick creates no second release** (idempotent); a per-grant email failure is recorded `failed` without aborting. **Contract (Supertest)** — public `GET /api/release/{token}` returns the note once, `410` on second/expired, `404`/`410` on unknown, **`500` fail-closed on decrypt failure with `viewed_at` unset**, and is rate-limited; authed `POST /api/deadman/test-release` creates a `manual_test` release with state unchanged, `401` unauth, error when no verified contact. **Client** — the `/r/:token` page renders the warning+note, the no-longer-available fallback, and a generic error. **e2e** — arm → fast-forward miss → grace → trigger → open link once → gone. All wired into CI; merge blocked unless green. Every server/e2e test keeps `DEADMAN_TICK_DISABLED=1`. |
| II | Keep It Simple | ✅ PASS | Smallest design meeting the spec: the two tables the roadmap §3 already specifies (`release`, `release_grant`) — no per-event or per-cron bookkeeping table; **no new dependency** (token = `randomBytes`, hash = `createHash`; rate-limit = a ~20-line in-process fixed-window counter rather than a library); **reuse** the existing hashed-token pattern, the keyring/note-cipher decrypt, and the `notify()` dispatcher; **extend** the engine's existing trigger rather than adding a parallel release pipeline; **one** public route + **one** authed route + **one** client page. Idempotency is a state + existing-release check, not a distributed lock. The grant TTL is a required shared constant, not speculative config. → Complexity Tracking left empty. |
| III | Typed End to End | ✅ PASS | The release-view response, the test-release response, both endpoints, and the extended `DeadmanEvent` enum (`released`) are defined once in `contracts/openapi.yaml`, generated into `shared/src/api.ts` (`npm run gen:api`), and consumed by both client (`releaseClient.ts`, the `/r/:token` page, `deadmanClient.ts`) and server (the public release route, the test-release handler, the release repo via `components["schemas"]`). The path param + token inputs are validated with Zod returning the existing `ParseResult`-style union. `any` avoided; `tsc --noEmit` in CI. The grant TTL is a typed shared constant. |
| IV | Accessible by Default | ✅ PASS | The public `/r/:token` page uses a semantic heading + landmark, a prominent **text** "this can only be opened once" warning (not colour-only), and an accessible live region (`role="status"`/`role="alert"`) announcing the note vs the "no longer available" / error outcomes; it is keyboard-reachable and reachable without a session — mirroring `ContactVerifiedPage`/`NoteEditor`. WCAG AA contrast inherited from existing styles plus any new view-once classes. |
| V | Small Pull Requests | ✅ PASS | Sliced into independently reviewable steps: **(1)** contract (+`released` enum + the two paths + response schemas) + shared grant TTL + the two tables/index + the shared token helper + release-repo + server unit tests; **(2)** extend the engine trigger (release + verified-only grants + emails + `email_status` + `released` event + idempotency) + engine unit tests; **(3)** the public `GET /api/release/{token}` route (decrypt-once, 410, fail-closed 500, rate-limit) + its contract tests + `app.ts` mount; **(4)** the authed `POST /api/deadman/test-release` + its contract tests; **(5)** client `releaseClient.ts` + `testRelease()` + the `/r/:token` page + route + client tests; **(6)** e2e cycle + README (Architecture/Tests) updates. Each is reviewable in one sitting and committed as its own bisectable `feat:` commit on the single feature branch (per roadmap §5). |

**Merge gates** (constitution Development Workflow): a PR merges only when (1) tests pass,
(2) `tsc` type-check passes, and (3) the new UI meets the accessibility baseline.

**Result**: PASS. No violations requiring justification → Complexity Tracking left empty.

**Post-design re-check (after Phase 1)**: Still PASS. The two tables match roadmap §3 exactly; the grant
token reuses the `auth/`/009 hashed-token pattern via a shared helper (also serving 011); the public
open path reuses the existing keyring fail-closed decrypt; idempotency is a state + existing-release
check (no lock, no queue); rate-limiting is a tiny in-process counter (no dependency). No note plaintext
or token is ever persisted outside the existing ciphertext/hash. All five principles remain satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/010-release-delivery/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification (+ Clarifications)
├── research.md          # Phase 0 output — decisions (token-helper sharing with 011, grant TTL, idempotency guard, fail-closed decrypt, rate-limit approach)
├── data-model.md        # Phase 1 output — release + release_grant tables, grant lifecycle + email_status state
├── quickstart.md        # Phase 1 output — fire a switch, open a grant link once, see it go 410; preview via test-release
├── contracts/
│   └── release-api.md   # Phase 1 — HTTP contract for GET /release/{token} and POST /deadman/test-release
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root) — additions/changes to the existing layout

```text
contracts/openapi.yaml                  # ADD: public GET /release/{token} (no security) returning a ReleaseView
                                        #      ({ note } on first open) with 410/404/500 responses; authed
                                        #      POST /deadman/test-release (sessionCookie) returning a TestReleaseResult;
                                        #      EXTEND DeadmanEvent type enum with `released`; mirror Note/Contact style

shared/src/
├── constants.ts                        # ADD: RELEASE_GRANT_TTL_SECONDS (e.g. 2_592_000 = 30 days)
├── index.ts                            # ADD: re-export RELEASE_GRANT_TTL_SECONDS
└── api.ts                              # REGENERATED via `npm run gen:api` from openapi.yaml

server/
├── src/
│   ├── app.ts                          # MOUNT: public GET /api/release/{token} (BEFORE requireAuth) via createReleaseRouter
│   │                                    #        (pass the keyring + a rate limiter); ADD authed POST /deadman/test-release
│   │                                    #        wiring (pass appBaseUrl + emailProvider + keyring into the deadman router)
│   ├── config/
│   │   └── env.ts                      # (REUSE) APP_BASE_URL already read (008); no new env var
│   ├── db/
│   │   ├── index.ts                    # ADD release + release_grant tables + idx_release_grant_token in openDb (roadmap §3);
│   │   │                                #      EXTEND clearDeadman (or add a clearReleases) to wipe them in the test-reset path
│   │   ├── release-repo.ts             # NEW: createRelease, createGrants (verified-only snapshot), getGrantByTokenHash,
│   │   │                                #      markGrantViewed (single-use), setGrantEmailStatus, hasReleaseForCycle (idempotency),
│   │   │                                #      decryptNoteForRelease helper (or call note-repo) — never persists token/plaintext
│   │   ├── contact-repo.ts             # ADD listVerifiedContacts(db, userId) (verified_at IS NOT NULL) for the snapshot
│   │   └── note-repo.ts                # (REUSE) decryptRow/getNote pattern; ADD getNoteForOwner(db, userId, keyring) if a
│   │   │                                #      non-self-scoped decrypt is needed by the public route (fail-closed; FR-010)
│   │   └── deadman-release.ts          # (optional) thin glue if release-repo grows; KISS prefers folding into release-repo.ts
│   ├── deadman/
│   │   ├── tokens.ts                   # NEW shared helper (roadmap §2): mintToken (randomBytes), hashToken (sha256),
│   │   │                                #      compareToken (constant-time) — shared with feature 011; mirrors auth/tokens.ts
│   │   ├── engine.ts                   # EXTEND trigger(): create release, snapshot verified contacts, mint grants, email each
│   │   │                                #      via notify(), record email_status, setState('triggered'), record triggered+released;
│   │   │                                #      idempotency guard (state + hasReleaseForCycle); pure-ish via injected deps
│   │   ├── deps.ts                     # EXTEND Deps wiring: add keyring, appBaseUrl, a release-email sender, verified-contact
│   │   │                                #      lister, and a per-grant notify that returns a provider message id / failure
│   │   └── release-email.ts            # NEW: buildReleaseEmail(appBaseUrl, token, recipient) → { subject, body } — a message
│   │   │                                #      awaits + the /r/<token> link; no plaintext, suitable for notify()
│   │   └── test-release.ts             # NEW: runTestRelease(db, deps, userId) — manual_test release to own verified address(es),
│   │   │                                #      no state change (used by the authed route + feature 012)
│   ├── routes/
│   │   ├── release.ts                  # NEW PUBLIC router: GET /{token} (hash → getGrantByTokenHash → expiry/view-once →
│   │   │                                #      decrypt via keyring → markGrantViewed → ReleaseView; 410 gone; 500 fail-closed)
│   │   └── deadman.ts                  # ADD authed POST /test-release handler (runTestRelease, scoped to req.user.id)
│   ├── middleware/
│   │   └── rate-limit.ts               # NEW tiny in-process fixed-window limiter (no dependency) for the public release route
│   └── validation/
│       └── release.ts                  # NEW: parse the {token} path param (presence/shape) for the public route
└── tests/
    ├── unit/                           # deadman-tokens, release-repo, engine-release (trigger/idempotent/verified-only/email-fail)
    └── contract/                       # release-public (success/410/404/500/rate-limit), deadman-test-release

client/
├── src/
│   ├── App.tsx                         # ADD a PUBLIC route /r/:token → <ReleaseViewPage/> (OUTSIDE ProtectedRoute)
│   ├── pages/
│   │   └── ReleaseViewPage.tsx         # NEW public page: read :token, call open-once, render warning + note / no-longer-available / error (a11y)
│   ├── api/
│   │   ├── releaseClient.ts            # NEW: openRelease(token) → ReleaseView | gone | error, using apiFetch (no silent-refresh needed; public)
│   │   └── deadmanClient.ts            # ADD testRelease() (authed POST /deadman/test-release)
│   └── styles.css                      # ADD: view-once warning + note classes (WCAG AA, text-labelled, not colour-only)
└── tests/
    ├── pages/                          # ReleaseViewPage.test.tsx (note+warning / gone / error)
    └── components/ or api/             # (as needed for the client call)

e2e/
├── support/                            # (REUSE) loginAs, the capturing email provider, the DEADMAN_TEST_MODE fast-forward seam
└── release-delivery.spec.ts           # NEW: arm → fast-forward miss → grace → trigger → read /r/<token> link once → reopen = gone

README.md                               # UPDATE Architecture (the release + release_grant tables, the engine trigger→release flow,
                                        #   the public GET /api/release/{token} one-time decrypt, the authed test-release preview,
                                        #   rate-limiting) and Tests (the new test files); Manual setup unchanged (no new env/service)
```

**Structure Decision**: Keep the existing web-app layout (npm workspaces `client/`, `server/`,
`shared/`). The feature **extends** the established dead-man vertical slice — tables → repo → engine →
route on the server; OpenAPI → generated shared types; API module → page on the client — rather than
adding a parallel one. Release state lives in the two roadmap-§3 tables (`release`, `release_grant`); the
**public** open route is a small separate router mounted **before** `requireAuth` (token-only authority,
like the public auth callbacks and the 009 verify route) and **rate-limited**; the **authed**
test-release is a new handler on the existing `createDeadmanRouter`. The grant token mint/hash/compare go
in a **shared** `deadman/tokens.ts` (also used by feature 011), mirroring `auth/tokens.ts`; the note is
decrypted via the existing keyring + `note-repo` fail-closed path; emails go through the generic
`notify()` dispatcher with an `APP_BASE_URL/r/<token>` link. The new public view-once page is registered
**outside** `ProtectedRoute` in `App.tsx`. Because this feature **adds endpoints, two tables, and a page**
but introduces **no new env var or external service** (it reuses `APP_BASE_URL`, the email channel, and
the keyring), the README **Architecture** and **Tests** sections are updated in the same commits, while
**Run** and **Manual setup** are left unchanged (per CLAUDE.md README policy).

## Complexity Tracking

> No constitution violations — this section intentionally left empty. (The two tables are exactly those
> the roadmap §3 specifies; the grant token reuses the existing SHA-256 hashed-token pattern via a shared
> helper also serving feature 011; the public open path reuses the existing keyring fail-closed decrypt;
> idempotency is a switch-state + existing-release check rather than a lock or queue; rate-limiting is a
> small in-process fixed-window counter rather than a new dependency. No note plaintext or token is ever
> persisted outside the existing ciphertext/hash, and no provider is called outside the generic
> dispatcher.)
