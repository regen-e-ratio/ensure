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
  Each contact also carries **verification state** (`verified_at`, `verification_token_hash`,
  `verification_expires_at`); the serialized contact exposes a derived `verified` boolean and a
  nullable `verifiedAt` (the hash/expiry stay internal). A contact must prove control of its address
  before it can ever receive a release (prerequisite for the future release feature) — every
  pre-existing contact is **unverified by default** (null `verified_at`).
- **`POST /api/contact/{id}/verify`** (protected by `requireAuth`, scoped to the caller) — mints a
  high-entropy token, stores **only its SHA-256 hash** plus a future expiry
  (`CONTACT_VERIFICATION_TTL_SECONDS`, 24 h) on the owned contact, and sends a verification email
  through the generic `notify()` dispatcher whose body carries a single `APP_BASE_URL` link
  (`/contact-verified?token=…`) with the raw token shown once. A non-owned/absent id is `404` (no
  email); resending refreshes the token (overwriting the prior hash/expiry, invalidating any earlier
  link). The token mint/hash mirrors the session-token pattern (`server/src/contacts/`); the raw token
  is never stored, logged, or serialized.
- **`GET /api/contact/verify?token=…`** — **PUBLIC** (no session; mounted *before* `requireAuth`,
  token-only authority). Hashes the token, looks the contact up by hash, enforces an inclusive expiry
  boundary and single-use, sets `verified_at`, and returns `{ status: "verified" | "already_verified" |
  "invalid_or_expired" }`. Expired/used/unknown/malformed tokens all return the generic
  `invalid_or_expired` result (fail-closed, discloses no contact/owner existence). The SPA renders the
  outcome on the public **`/contact-verified`** page; the contact list shows a text-labelled
  verified/unverified badge and a "Send verification"/"Resend" action.
- **`/api/notifications`** (protected by `requireAuth`) — the generic notification system.
  `GET /channels` lists each channel with its availability and input fields; `POST /test` sends one
  notification through the same generic capability any caller uses and returns an explicit outcome.
  Invalid input → `400 VALIDATION_ERROR` (no delivery); a known-but-disabled channel →
  `400 CHANNEL_NOT_SUPPORTED`; a delivery attempt → `200` with `{ outcome: { status: "sent" | "failed", … } }`.
- **`/api/deadman`** (protected by `requireAuth`) — the per-user dead-man switch, scoped to the caller.
  `GET /` returns the switch status (state, configured interval/grace, absolute deadlines, a derived
  `secondsUntilDue` countdown, and recent events newest-first; a never-configured switch is `disarmed`
  with defaults and null deadlines). `PUT /config` sets the interval/grace (validated against the shared
  bounds) and arms (`enabled:true` → `active`, sets `nextCheckinDueAt = now + interval`) or disarms
  (`enabled:false` → `disarmed`, clears deadlines). `POST /checkin` is the "I'm alive" reset on an
  `active`/`grace` switch (→ `active`, deadline reset); it is rejected `409` when disarmed/triggered. The
  SPA surfaces this at the protected **`/deadman`** dashboard (state badge, live countdown, big check-in
  button, config form with a confirm before the first arm, and a recent-events list).
  `POST /deadman/test-release` (scoped to the caller) mints a one-time grant to the caller's **own**
  verified contact address(es), creates a release tagged `manual_test`, and emails each a tokenized
  `/r/<token>` link via `notify()` **without changing the switch state**, so a user can preview exactly
  what their contacts will receive (`409 NO_VERIFIED_CONTACT` when the caller has no verified contact).
- **`GET /api/release/{token}`** — **PUBLIC** (no session; mounted *before* `requireAuth`, token-only
  authority) and **rate-limited** (`server/src/middleware/rate-limit.ts`, a tiny in-process fixed-window
  limiter). When a switch fires (or a test-release runs), each verified contact is emailed a one-time
  tokenized link to this route. The server hashes the supplied token, looks the **release grant** up by
  hash, and — only when the grant is valid, **unviewed**, and **unexpired** — decrypts the note owner's
  note server-side via the keyring, marks the grant `viewed_at` (**view-once**), and returns the note
  exactly once. A second open or an expired grant → `410 Gone`; an unknown/malformed token → a generic
  `404` disclosing nothing; a decrypt failure **fails closed** with `500` and leaves the grant unviewed
  (retryable, never leaks plaintext). The SPA renders this on the public **`/r/:token`** view-once page
  (prominent "this can only be opened once" warning + the note, or a "no longer available" message).

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

`better-sqlite3` (WAL, foreign keys on) at `./data/note.db` (`NOTE_DB_PATH`). Eight tables:

- **`note`** — one row per owner, keyed by `user_id` (PRIMARY KEY → at most one note per user).
  Content is stored as `ciphertext` (BLOB) with the `key_version` that protects it (indexed) plus
  `created_at`/`updated_at` — there is no plaintext column.
- **`user`** — provisioned from the Google profile (`id`, `email`, `name`, timestamps).
- **`session`** — backs the refresh token (`token_hash` unique, `expires_at`, `last_used_at`).
- **`contact`** — a user's contacts (`id` PK, `user_id` FK, indexed). Carries an explicit `type`
  (`email` today; the column exists so future types need no migration), the `value` (original case)
  and a derived `value_norm` with `UNIQUE(user_id, type, value_norm)` for case-insensitive
  de-duplication, plus `created_at`. Stored as plaintext (no encryption requirement). Also holds
  per-contact **verification** columns — `verified_at` (null = unverified), `verification_token_hash`
  (SHA-256 of the current token; the raw token is never stored), and `verification_expires_at` — added
  nullably (no backfill) with a partial `idx_contact_verification_hash` index backing the public
  token lookup.
- **`deadman_config`** — one row per user (PK `user_id`) holding the switch `enabled` flag, the
  `state` (`disarmed`/`active`/`grace`/`triggered`), the `checkin_interval_seconds`/`grace_period_seconds`,
  the absolute `last_checkin_at`/`next_checkin_due_at`/`grace_deadline_at` timestamps (so restarts never
  lose time or fire early), a `reminders_sent` counter, and timestamps. Indexed on
  `(state, next_checkin_due_at)` so the engine cheaply selects due switches.
- **`deadman_event`** — an append-only per-user audit log (`id` PK, `user_id` FK, `type`, optional JSON
  `detail`, `created_at`, indexed on `(user_id, created_at)`). `detail` never holds note plaintext or
  any token. `type` includes `released` (recorded alongside `triggered` when a fired switch releases),
  whose `detail` carries only a non-sensitive grant count.
- **`release`** — one row per fired (or test) cycle (`id` PK, `user_id` FK, `trigger`
  (`schedule`/`manual_test`), `created_at`); groups the grants created for that cycle.
- **`release_grant`** — one row per recipient (`id` PK, `release_id` FK, `user_id` = the **note owner**
  for decrypt, `contact_id` FK, `token_hash` UNIQUE, `expires_at`, view-once `viewed_at`, per-grant
  `email_status`/`provider_message_id`/`email_error`, `created_at`), indexed on `token_hash`
  (`idx_release_grant_token`) for the public lookup. Only the SHA-256 **hash** of the one-time token is
  stored — never the raw token, never note plaintext.

### Encryption at rest

Note content is sealed with **AES-256-GCM** using Node's built-in `crypto` (no new dependency) in
`server/src/crypto/` — a versioned **keyring** (`keyring.ts`) plus the cipher (`note-cipher.ts`). The
keyring comes from env (`NOTE_ENC_KEYS` + `NOTE_ENC_ACTIVE_VERSION`), never the database: new/updated
notes use the active version; any present version can decrypt; an unknown version or failed auth tag
**fails closed**. Rotation is non-disruptive — add a new version and point the active version at it
(new saves migrate lazily), then run the operator CLI `npm run reencrypt --workspace server` to
re-encrypt every remaining note so the old version can be retired once no note depends on it.

### Notifications

A generic, reusable notification system in `server/src/notifications/`. A single `notify()`
dispatcher routes a `{ channel, recipient, content }` request through a **channel registry** to the
matching `NotificationChannel` handler, returning an explicit outcome (sent, or failed with a reason);
unknown/disabled channels are rejected with `CHANNEL_NOT_SUPPORTED`. Only **Email** is enabled;
WhatsApp and push are registered as unavailable so the UI can show the extension point. The Email
channel validates its fields, **sanitizes HTML bodies** server-side (`sanitize-html`) before sending,
and bounds the provider call with a 30s timeout.

The external email vendor sits behind a one-method **`EmailProvider` port** so it is swappable with no
caller changes. **No vendor is wired yet**: the default `StubEmailProvider` performs no network send
(it lets the pipeline run end-to-end), selected by `EMAIL_PROVIDER` (default `stub`). Adding a real
provider is a single adapter implementing `EmailProvider`, registered in `channels/email/providers.ts`
and selected via `EMAIL_PROVIDER` — see `specs/005-notifications-system/email-providers.md`. The
client `/notifications` page (gated behind sign-in) drives its form from `GET /channels` and lets an
operator send a test notification and see the outcome.

### Liveness engine (dead-man switch)

The per-user dead-man switch lives in `server/src/deadman/`. A **pure `evaluate(config, now)`**
(`engine.ts`) decides the next transition for one switch (`stay`/`enter_grace`/`remind`/`trigger`/`noop`)
with no I/O; **`runDeadmanTick(db, deps, now)`** loads due switches (`config-repo.listDue`) and applies
those decisions through injected `deps` (a notifier closure over the generic `notify()` dispatcher + a
`Date` clock + a user-email resolver). It is **idempotent and state-guarded**, so repeated ticks never
double-send a reminder beyond the cap nor re-trigger. On a missed deadline a switch moves `active → grace`,
**grace reminders are emailed to the user's own account address** (via `notify()`, never a provider
directly), capped per grace window; if grace also lapses it **triggers a release**.

On trigger the engine snapshots **only verified contacts** (`verified_at != null`), creates a `release`,
mints **one high-entropy grant token per contact** (storing only its SHA-256 hash + a 30-day
`expires_at`, `RELEASE_GRANT_TTL_SECONDS`), emails each a tokenized `${APP_BASE_URL}/r/<token>` link via
`notify()` (recording per-grant `email_status`; a single send failure is recorded `failed` and never
aborts the batch), transitions to `triggered`, and records `triggered` + `released`. Release creation is
**idempotent** — guarded on switch state **plus** an existing-release check — so the in-process timer and
an external cron can never double-release. The shared mint/hash/compare helpers live in
`server/src/deadman/tokens.ts` (reused by check-in links); the release email builder in
`release-email.ts` carries no note plaintext. The note is decrypted **only** at the moment a valid grant
link is opened on the public `GET /api/release/{token}` route (server-side, fail-closed), then the token
burns.

The tick is driven by an **in-process timer** (`driver.ts` → `startDeadmanTimer`, every `DEADMAN_TICK_MS`,
default 60 s) wired into `server.ts` boot, which also runs a **one-shot boot-recovery tick** so a deadline
that lapsed while the process was down is evaluated on startup. The timer is **disabled** when
`DEADMAN_TICK_DISABLED=1` (tests, or when an external scheduler is used). The same single tick is exposed
as **`npm run deadman:tick --workspace server`** (`cli/deadman-tick.ts`) for an external cron/k8s CronJob.

### Test seams (never in production)

Mounted only when their env gate is set: `POST /api/test/login` (`AUTH_TEST_MODE=1`) mints a real
session for a fake user without contacting Google; `POST /api/test/reset`
(`NOTE_ALLOW_TEST_RESET=1`) clears the note, contacts, switch state, and releases/grants, and (same
gate) mounts `GET /api/test/emails` so e2e can read back the verification or release link the server
emailed; and `POST /api/test/deadman`
(`DEADMAN_TEST_MODE=1`) fast-forwards the caller's switch deadlines into the past and runs one tick, so
e2e can drive miss-deadline → grace → triggered (and the resulting release) without waiting real time. These let Playwright exercise the real
middleware and cookies while skipping Google's non-automatable consent screen.

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
`/login`. The **Notifications** link (or <http://localhost:5173/notifications>) opens the notification
test page; the **Switch** link (or <http://localhost:5173/deadman>) opens the dead-man switch dashboard.

The server runs the **in-process liveness timer** automatically on boot (every `DEADMAN_TICK_MS`,
default 60 s; recovers any due switch on startup). To drive the engine from an external scheduler
instead, set `DEADMAN_TICK_DISABLED=1` and run one tick per cron interval:

```bash
npm run deadman:tick --workspace server   # runs a single liveness tick, then exits
```

**Local DB helpers** (dev only) — per-table CLIs to inspect/seed the SQLite store, reading the same
`server/.env` and database as the app: `db:user`, `db:contact`, `db:note` (decrypts via the keyring),
`db:session`. Run e.g. `npm run db:user --workspace server -- -seed` or `... -- -h` for actions.

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

**Optional** — `EMAIL_PROVIDER` selects the email provider for the notification system. It defaults to
`stub` (in-process, **no real email is sent**), which needs no setup. No email vendor is integrated
yet; to add one, implement an `EmailProvider` adapter and set `EMAIL_PROVIDER` to its name (see
[`specs/005-notifications-system/email-providers.md`](specs/005-notifications-system/email-providers.md)),
supplying its credentials here server-side.

**Optional, local-debug-only** — `EMAIL_STUB_DEBUG=1` turns on a debug log in the email **stub**: for
each send it writes one line to the server console with the recipient, subject, body, and body format
the backend received, to verify the test-page fields reach the backend. It is **off by default** and
applies only to the stub. ⚠️ Enabling it writes recipient and message content to the console, so use
it only on your local machine — never set it in a shared or production environment.

**Optional — dead-man liveness engine** (feature 008; all have safe defaults, none is a secret):

| Variable                | Purpose |
|-------------------------|---------|
| `DEADMAN_TICK_MS`       | In-process liveness tick interval in ms (default `60000`). |
| `DEADMAN_TICK_DISABLED` | Set `1` to turn off the in-process timer (use an external cron driving `npm run deadman:tick --workspace server`, or set by tests so the timer never runs). |
| `APP_BASE_URL`          | Absolute base URL used to build links placed in emails (default `http://localhost:5173`). |
| `DEADMAN_TEST_MODE`     | **Test-only** — set `1` to mount `POST /api/test/deadman` (fast-forwards a switch's deadlines for e2e). Never enable in production. |

**Test-only** (optional; never enable in production): `AUTH_TEST_MODE=1` mounts the test-login seam,
`NOTE_ALLOW_TEST_RESET=1` mounts the reset route, and `DEADMAN_TEST_MODE=1` mounts the deadman
fast-forward seam. The e2e suite sets these (plus `DEADMAN_TICK_DISABLED=1` so the timer stays off, and
dummy Google/JWT values **and a test keyring**) itself — see [`playwright.config.ts`](playwright.config.ts)
— so you do **not** need real Google credentials or keys to run e2e.

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

The dead-man **liveness engine** is exhaustively unit-tested with an injected clock + a spy notifier
(`server/tests/unit/deadman-*`) and via Supertest contract tests (`server/tests/contract/deadman-*`); the
dashboard has RTL tests and there is a Playwright spec (`e2e/deadman.spec.ts`). **Every server/e2e test
sets `DEADMAN_TICK_DISABLED=1`** so the in-process timer never runs and the engine is driven explicitly via
`runDeadmanTick` (the test helper and `playwright.config.ts` set this for you).

**Contact verification** is covered at every layer: token helper units
(`server/tests/unit/contact-verification-token.test.ts`), repo units for the verification helpers,
`toContact`, idempotent `markVerified`, and single-use/resend-supersede
(`server/tests/unit/contact-repo.test.ts`), Supertest contract tests for the authed send
(`server/tests/contract/contact-verify-send.test.ts`) and the public, fail-closed verify
(`server/tests/contract/contact-verify-public.test.ts`), client component/page tests
(`client/tests/components/ContactList.verify.test.tsx`, `client/tests/pages/ContactVerifiedPage.test.tsx`),
and an end-to-end round-trip (`e2e/contact-verification.spec.ts`: add → send → open the captured link →
verified badge, asserting the raw token never leaks). The raw verification token appears in no test
fixture, log, event, or serialized contact — only its SHA-256 hash is persisted.

**Release & one-time delivery** is covered end to end: token-helper units
(`server/tests/unit/deadman-tokens.test.ts`), release-repo units
(`server/tests/unit/release-repo.test.ts`: create release/grants for verified-only, lookup-by-hash,
single-use `markGrantViewed`, email status, idempotency guard), engine units
(`server/tests/unit/engine-release.test.ts`: trigger → release + verified-only grants + emails via a spy
notifier, idempotent re-tick, per-grant failure resilience), the manual test-release unit
(`server/tests/unit/test-release.test.ts`: `manual_test` release, state untouched), Supertest contract
tests for the public view-once route (`server/tests/contract/release-public.test.ts`: 200-once, 410
replay/expired, 404 unknown/malformed, **500 fail-closed decrypt with `viewed_at` unset**, rate-limit)
and the authed preview (`server/tests/contract/deadman-test-release.test.ts`), a client page test
(`client/tests/pages/ReleaseViewPage.test.tsx`), and a full Playwright cycle
(`e2e/release-delivery.spec.ts`: arm → fast-forward → grace → triggered → open `/r/<token>` once →
reopen = gone). No raw grant token or note plaintext appears in any log, event, or persisted
release/grant row — only the SHA-256 hash and the existing `note.ciphertext` are stored.

**Merge gates** ([constitution](.specify/memory/constitution.md)): a change merges only when tests
and e2e pass, `typecheck` passes, and UI changes meet the accessibility baseline (semantic HTML,
labelled controls, keyboard navigation, WCAG AA contrast).
