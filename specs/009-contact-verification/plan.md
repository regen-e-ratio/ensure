# Implementation Plan: Contact Verification

**Branch**: `feat/deadman-switch` (feature `009-contact-verification`) | **Date**: 2026-06-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-contact-verification/spec.md`

## Summary

Make a contact **prove control of its address** before it can ever receive a release. Extend the
existing per-user `contact` table (feature 006) in place with three nullable columns —
`verified_at`, `verification_token_hash`, `verification_expires_at` — so every pre-existing row is
**unverified by default** (null `verified_at`). The owner triggers a verification round-trip via a new
authed endpoint **`POST /api/contact/{id}/verify`** (scoped to `req.user.id`): mint a high-entropy
token, store **only its SHA-256 hash** + a future expiry on the contact, and send a verification email
through the generic **`notify()`** dispatcher whose body carries a single **`APP_BASE_URL`** link with
the raw token shown **once**. Resending mints a fresh token and overwrites the stored hash/expiry,
invalidating any prior link. A **public** (no-auth) endpoint **`GET /api/contact/verify?token=…`** hashes
the incoming token, looks the contact up by hash, enforces expiry + single-use, sets `verified_at`, and
returns a success/failure **result** (fail-closed, no contact/owner disclosure).

The token lifecycle mirrors the existing **session/refresh-token** pattern in `auth/` (raw value shown
once in a URL, only the SHA-256 hash persisted, time-limited, single-use, compared by hashing the
incoming value) — the raw token is never stored, logged, or serialized. The OpenAPI **`Contact`** schema
gains a derived **`verified`** boolean and a nullable **`verifiedAt`** (the hash/expiry stay internal);
`contracts/openapi.yaml` adds the two paths and is regenerated into `shared/src/api.ts` via
`npm run gen:api`, with the shared **verification-token TTL** in `shared/src/constants.ts`.

On the client, `ContactList` gains a per-contact **verified/unverified badge** (text-labelled, not
colour-only) and a **"Send verification" / "Resend"** action with accessible status messaging
(`role="status"` confirmation, `role="alert"` error), plus a new `verifyContact()` call in
`contactClient.ts`; a **public verification-result page** (route `/contact-verified`) renders the
success or invalid/expired/used outcome, registered **outside** `ProtectedRoute` in `App.tsx`. This is a
**prerequisite for feature 010** (release) — only verified contacts will ever receive a one-time release
link — but performs no release itself.

## Technical Context

**Language/Version**: TypeScript 5.6+ on Node.js 22 (server, run via `tsx`, ESM) and the browser SPA
(client); unchanged from 001/002/006/008.

**Primary Dependencies**: Express 5, Zod, better-sqlite3 (server); React 18 + React Router (client);
the existing `notify()` dispatcher + email channel (feature 005); the existing hashed-token helpers
(`auth/tokens.ts` — `randomBytes`/`createHash`). **No new runtime dependency** — token mint is
`node:crypto.randomBytes`, the hash is SHA-256 (`createHash`), and the link is built from `APP_BASE_URL`
read in the boot path. (KISS — the token reuses the session pattern, no new abstraction.)

**Storage**: Existing SQLite DB (better-sqlite3). **No new table** — three nullable columns are added to
the existing `contact` table in `openDb()` (`verified_at`, `verification_token_hash`,
`verification_expires_at`), added with `ALTER TABLE … ADD COLUMN` semantics expressed idempotently so a
fresh DB and an existing DB converge; a partial index on `verification_token_hash` (where non-null)
backs the public lookup. `user`, `session`, `note`, `deadman_*` tables are unchanged. The raw token is
never stored (only its hash); no token value is ever persisted in plaintext.

**Testing**: Vitest (server unit + contract via Supertest; client via React Testing Library) and
Playwright e2e — all already configured. New tests: token-helper unit (mint entropy, hash determinism,
constant-time/look-up-by-hash semantics), contact-repo unit (set verification token, find-by-hash,
mark-verified, idempotent re-verify, `toContact` includes `verified`/`verifiedAt`), contract tests for
`POST /api/contact/{id}/verify` (sends via spy notifier; `401` unauth; `404` non-owned) and the public
`GET /api/contact/verify` (success; expired; used/replayed; invalid/missing token — fail-closed),
client component tests for the badge + send/resend action + result page, and an e2e spec (add contact →
send verification → open the captured link → verified badge). **All server/e2e tests set
`DEADMAN_TICK_DISABLED=1`** (carried over from 008) so the in-process timer never runs.

**Target Platform**: Linux server (single Node process) + existing browser SPA, single-instance deploy.

**Project Type**: Web application (existing npm workspaces `client/`, `server/`, `shared/`).

**Performance Goals**: The public verify lookup is a single indexed read on
`verification_token_hash` — O(1) at this scale. No change to the existing local p95 < 200 ms target for
the synchronous endpoints.

**Constraints**:
- The verification token reuses the **hashed-token** pattern: a high-entropy random value is shown
  **once** in the email link; the DB stores **only** its SHA-256 hash; lookups hash the incoming token
  and compare (FR-012). The raw token is never stored, logged, or serialized (FR-004, FR-012, SC-006).
- The token is **time-limited** (`verification_expires_at`, default 24 h) and **single-use** (consumed
  when `verified_at` is set); a resend supersedes any prior link (FR-005, FR-009).
- The public `GET /api/contact/verify` is **fail-closed** and **non-disclosing**: expired / used /
  unknown / malformed tokens all return a generic invalid-or-expired result revealing no contact or
  owner existence (FR-010, SC-002).
- The **send** endpoint is scoped by `req.user.id`; a non-owned contact id is `404` with no email
  (FR-006); unauthenticated sends are `401` (FR-007).
- Verification is **idempotent**: a valid re-open or a resend never moves or clears `verified_at`
  (FR-011, SC-005).
- Pre-existing contacts are **unverified by default** — columns are added nullable with no backfill; a
  null `verified_at` means unverified (FR-001, SC-004).
- Emails go only through the generic **`notify()`** dispatcher (never a provider directly); the body
  carries a single `APP_BASE_URL` link and no secret (FR-004, roadmap conventions).
- The UI signals verification state with a **text-labelled** badge (not colour alone) and accessible
  status/alert messaging; the result page is keyboard-reachable without a session (FR-014, FR-015).

**Scale/Scope**: Small number of users, ≤ 50 contacts each. New: three columns + one index; verification
helpers in the contact repo (or a small `contact-verification.ts`); two routes (one authed mounted on
the existing contact router, one public); the verification email builder; a `verifyContact()` client
call + the badge/action UI; a public result page + route; OpenAPI additions + a shared TTL constant; and
tests at every layer.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|-----------|--------|----------------------------|
| I | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Tests written with/before code at every layer. **Unit (tokens)** — the verification token helper mints a high-entropy value, hashes deterministically (SHA-256), and supports look-up-by-hash; the raw token never round-trips through storage. **Unit (repo)** — `setVerificationToken` stores hash + expiry (never the raw token), `findByVerificationHash` returns the matching contact, `markVerified` sets `verified_at` once and is idempotent on re-verify, and `toContact` exposes `verified`/`verifiedAt` (unverified default for null `verified_at`). **Contract (Supertest)** — `POST /api/contact/{id}/verify` sends via a **spy notifier** to the contact address with an `APP_BASE_URL` token link, `401` unauth, `404` non-owned, resend refreshes the token; public `GET /api/contact/verify` succeeds on a valid token, **fails closed** on expired/used/invalid (contact stays unverified, no disclosure). **Client** — `ContactList` renders the verified/unverified badge, the send/resend action, polite/assertive status; the result page renders success vs invalid/expired/used. **e2e** — add contact → send verification → open the captured link → verified badge. All wired into CI; merge blocked unless green. Tests keep `DEADMAN_TICK_DISABLED=1`. |
| II | Keep It Simple | ✅ PASS | Smallest design meeting the spec: **no new table** (three nullable columns on the existing `contact` row); **no new dependency** (token = `randomBytes`, hash = `createHash` — the very helpers `auth/` already uses); **reuse the existing hashed-token pattern** rather than inventing a verification-specific scheme; **one** authed route on the existing contact router + **one** public route; **one** client call + a badge/action on the existing `ContactList` + a single public result page. The TTL is a required shared constant (FR-013), not speculative config. No verification-job table, no queue, no per-contact token table — the contact row carries its own current token hash. → Complexity Tracking left empty. |
| III | Typed End to End | ✅ PASS | The extended `Contact` (`verified`, `verifiedAt`), the `ContactVerifyResult` (success / invalid-or-expired), and both endpoints are defined once in `contracts/openapi.yaml`, generated into `shared/src/api.ts` (`npm run gen:api`), and consumed by both client (`contactClient.ts`, the result page) and server (`routes/contact.ts`, the public verify route, the repo via `components["schemas"]["Contact"]`). The query/param inputs are validated with Zod returning the existing `ParseResult`-style discriminated union. `any` avoided; `tsc --noEmit` in CI. The verification TTL is a typed shared constant. |
| IV | Accessible by Default | ✅ PASS | The contact list's per-contact **badge** is a text-labelled element (e.g. "Verified" / "Not verified"), not colour-only, with an accessible name; the **"Send verification"/"Resend"** control is a real `<button>` with an `aria-label` naming its contact; success uses `role="status"` `aria-live="polite"` and failure uses `role="alert"`. The **public result page** uses semantic headings/landmarks, is keyboard-reachable, and announces the outcome — mirroring `ContactList`/`NoteEditor`. WCAG AA contrast inherited from existing styles plus any new badge classes. |
| V | Small Pull Requests | ✅ PASS | Sliced into independently reviewable steps: **(1)** contract + shared TTL + the three columns/index + repo verification helpers + token helper + server unit tests; **(2)** the authed `POST /api/contact/{id}/verify` + the verification-email builder + send contract tests; **(3)** the public `GET /api/contact/verify` route + its fail-closed contract tests + `app.ts` mount; **(4)** client `verifyContact()` + the badge/action in `ContactList` + the public result page + route + client tests; **(5)** e2e spec + README (Architecture/Tests, and Manual-setup only if `APP_BASE_URL` documentation needs it) updates. Each is reviewable in one sitting and committed as its own bisectable `feat:` commit on the single feature branch (per roadmap §5). |

**Merge gates** (constitution Development Workflow): a PR merges only when (1) tests pass,
(2) `tsc` type-check passes, and (3) the new UI meets the accessibility baseline.

**Result**: PASS. No violations requiring justification → Complexity Tracking left empty.

**Post-design re-check (after Phase 1)**: Still PASS. Adding verification state as three nullable
columns on the existing `contact` row (rather than a separate verification table), reusing the
`auth/`hashed-token pattern, and exposing a derived `verified` boolean add no abstraction beyond what
the spec demands. The public, token-only verify endpoint is the minimal way to let a non-user contact
confirm an address. No new dependency, no new table, no job machinery. All five principles remain
satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/009-contact-verification/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification (+ Clarifications)
├── research.md          # Phase 0 output — decisions (token pattern reuse, TTL, public-route disclosure, columns vs table)
├── data-model.md        # Phase 1 output — contact verification columns + token lifecycle + state
├── quickstart.md        # Phase 1 output — send a verification email, open the link, see the verified badge
├── contracts/
│   └── contact-verification-api.md  # Phase 1 — HTTP contract for POST /contact/{id}/verify and GET /contact/verify
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root) — additions/changes to the existing layout

```text
contracts/openapi.yaml                  # ADD: POST /contact/{id}/verify (authed) + GET /contact/verify (public) paths;
                                        #      EXTEND Contact schema with `verified` (boolean) + `verifiedAt` (nullable);
                                        #      ADD ContactVerifyResult / ContactVerifySendResponse schemas (Contact style)

shared/src/
├── constants.ts                        # ADD: CONTACT_VERIFICATION_TTL_SECONDS (e.g. 86_400 = 24 h)
├── index.ts                            # ADD: re-export CONTACT_VERIFICATION_TTL_SECONDS
└── api.ts                              # REGENERATED via `npm run gen:api` from openapi.yaml

server/
├── src/
│   ├── app.ts                          # MOUNT: GET /api/contact/verify (PUBLIC, before requireAuth) via a small
│   │                                    #        public router; the authed POST /contact/{id}/verify stays inside
│   │                                    #        createContactRouter under the existing /api/contact requireAuth mount;
│   │                                    #        pass APP_BASE_URL + emailProvider into the contact router/deps
│   ├── config/
│   │   └── env.ts                      # (REUSE) APP_BASE_URL is already read (feature 008); expose it to the contact wiring
│   ├── db/
│   │   ├── index.ts                    # ADD verified_at, verification_token_hash, verification_expires_at columns to the
│   │   │                                #      contact table + idx_contact_verification_hash (partial, non-null) in openDb
│   │   └── contact-repo.ts             # EXTEND ContactRow + toContact (add verified/verifiedAt); ADD setVerificationToken,
│   │                                    #      findByVerificationHash, markVerified (idempotent), getContactById(owned)
│   ├── contacts/                       # NEW small module for the verification email + token (KISS; or fold into routes)
│   │   ├── verification-token.ts       #   mint (randomBytes) + hashVerificationToken (sha256) — mirrors auth/tokens.ts
│   │   └── verification-email.ts       #   buildVerificationEmail(appBaseUrl, token, recipient) → {subject, body} (no secret beyond the link)
│   ├── routes/
│   │   ├── contact.ts                  # ADD authed `POST /:id/verify` handler (mint+hash+store+notify via the generic dispatcher)
│   │   └── contact-verify.ts           # NEW PUBLIC router: `GET /verify` (hash → find → expiry/single-use → markVerified → result)
│   └── validation/
│       └── contact.ts                  # ADD a tiny token query parser (presence/shape) for the public verify endpoint
└── tests/
    ├── unit/                           # contact-verification-token, contact-repo (verification helpers + toContact)
    └── contract/                       # contact-verify-send, contact-verify-public (success/expired/used/invalid)

client/
├── src/
│   ├── App.tsx                         # ADD a PUBLIC route /contact-verified → <ContactVerifiedPage/> (OUTSIDE ProtectedRoute)
│   ├── components/
│   │   └── ContactList.tsx             # ADD per-contact verified/unverified badge + "Send verification"/"Resend" action + a11y status
│   ├── pages/
│   │   └── ContactVerifiedPage.tsx     # NEW public page: read ?token, call verify, render success/invalid-expired-used (a11y)
│   ├── api/
│   │   └── contactClient.ts            # ADD verifyContact(id) (send) and confirmVerification(token) (public) using apiFetch
│   └── styles.css                      # ADD: verified/unverified badge classes (WCAG AA, text-labelled, not colour-only)
└── tests/
    ├── components/                     # ContactList.verify.test.tsx (badge + send/resend + status)
    └── pages/                          # ContactVerifiedPage.test.tsx (success vs invalid/expired/used)

e2e/
├── support/auth.ts                     # (REUSE) loginAs/resetContacts; verification reads the stub-captured email link
└── contact-verification.spec.ts        # NEW: add contact → send verification → open captured link → verified badge

README.md                               # UPDATE Architecture (contact verification columns, the two endpoints, the email
                                        #   round-trip via notify(), APP_BASE_URL link) and Tests (the new test files);
                                        #   Manual setup unchanged (APP_BASE_URL already documented by 008)
```

**Structure Decision**: Keep the existing web-app layout (npm workspaces `client/`, `server/`,
`shared/`). The feature **extends** the established contact vertical slice — column → repo →
validation → route on the server; OpenAPI → generated shared types; API module → component on the
client — rather than adding a parallel one. Verification state lives as three nullable columns on the
existing `contact` row (no new table); the **authed** send endpoint is a new handler on the existing
`createContactRouter` (mounted under `/api/contact` behind `requireAuth`), while the **public** verify
endpoint is a small separate router mounted **before** `requireAuth` (token-only authority, like the
public auth callbacks). The token mint/hash helpers mirror `auth/tokens.ts`, and the email goes through
the generic `notify()` dispatcher with an `APP_BASE_URL` link. The new public result page is registered
**outside** `ProtectedRoute` in `App.tsx`. Because this feature **adds endpoints and a contact
verification round-trip** but introduces **no new env var or external service** (it reuses `APP_BASE_URL`
and the existing email channel), the README **Architecture** and **Tests** sections are updated in the
same commits, while **Run** and **Manual setup** are left unchanged (per CLAUDE.md README policy).

## Complexity Tracking

> No constitution violations — this section intentionally left empty. (Verification state is three
> nullable columns on the existing `contact` row rather than a new table; the token reuses the existing
> SHA-256 hashed-token pattern from `auth/` with no new dependency; the public verify endpoint is the
> minimal token-only path needed for a non-user contact to confirm an address. No job machinery, no
> verification-specific token table, no provider call outside the generic dispatcher.)
