# Roadmap: Turning Ensure into a Working Dead-Man Switch

**Created**: 2026-06-20 · **Status**: Planning · **Branch family**: `008`–`012`

This document is the umbrella plan that turns Ensure — today a single encrypted note behind Google
sign-in — into a **functioning dead-man switch**: a service that periodically confirms a user is
alive and, if they stop responding, securely releases their note to their chosen contacts.

It decomposes the work into **five Spec-Kit features (008–012)**, each an independently testable,
independently mergeable slice that follows the existing `specs/00N-*` conventions and the
[constitution](../.specify/memory/constitution.md). Per-feature `spec.md` / `plan.md` / `tasks.md`
are generated under each feature folder; this file is the cross-feature picture, the shared data
model, and the key product/security decisions.

---

## 1. Product model (the mental model we are building)

```
        write note            add + verify contacts            arm the switch
  user ───────────────►  user ─────────────────────────►  user ──────────────►  ACTIVE
                                                                                    │
                       check in before each deadline ("I'm alive")  ◄──────────────┤
                                                                                    │ deadline passes
                                                                                    ▼
                                                                                  GRACE
                                                         reminders to user (dashboard + email links)
                                                                                    │ grace passes, still silent
                                                                                    ▼
                                                                               TRIGGERED
                              each verified contact gets an email with a one-time secure link ───►
                              contact opens link once ──► note decrypted server-side, shown once, token burns
```

**The switch is a per-user state machine**: `disarmed → active → grace → triggered`. The user can
disarm/pause at any time. A check-in (from the dashboard **or** a tokenized email link) resets the
clock back to `active`.

### Decisions locked for this roadmap

| Decision | Choice | Why |
|---|---|---|
| **Release delivery** | **Secure one-time link.** Contacts receive an email with a tokenized link to a public *view-once* page; the note is decrypted server-side only when opened, then the token burns. | Keeps plaintext out of inboxes/mail servers — consistent with the app's encrypt-at-rest, fail-closed design. |
| **Liveness engine** | **Pure `runDeadmanTick(db, deps, now)`** driven by an in-process `setInterval` (every 60 s, recovers on boot from absolute DB timestamps) **and** exposed as `npm run deadman:tick` for an external cron/k8s CronJob in production. | KISS, zero new dependencies, fully unit-testable with an injected clock. |
| **Scope** | Implement all five features (008–012) in dependency order. | User-approved full build. |

---

## 2. Architecture additions (grounded in the current codebase)

The current backend (`server/src/`) is an Express 5 app with a repository-over-`better-sqlite3` data
layer, a versioned AES-256-GCM keyring (`crypto/`), a generic `notify()` dispatcher
(`notifications/`), and **no scheduler of any kind**. The frontend (`client/src/`) is an accessible,
library-free React SPA with per-endpoint API clients and a `ProtectedRoute`/`AuthProvider` auth model.

New backend module: **`server/src/deadman/`**

| File | Responsibility |
|---|---|
| `engine.ts` | Pure state machine: `evaluate(config, now)` → transition decisions; `runDeadmanTick(db, deps, now)` applies them (send reminders, move `active→grace`, on grace-expiry create a release). Idempotent. No I/O except via injected `deps` (notifier, clock). |
| `config-repo.ts` | `getConfig`, `upsertConfig`, `recordCheckin`, `setState`, `listDue(now)` over the `deadman_config` table. |
| `event-repo.ts` | Append-only audit: `recordEvent`, `listEvents(userId)`. |
| `tokens.ts` | High-entropy token mint + SHA-256 hash-at-rest + constant-time compare (mirrors the session-token approach already used in `auth/`). Shared by check-in links (011) and release grants (010). |
| `release-repo.ts` | (010) `createRelease`, `createGrants`, `getGrantByTokenHash`, `markGrantViewed`, delivery status. |
| `driver.ts` | `startDeadmanTimer(db, deps)` → the `setInterval` wrapper used by `server.ts`; guarded by `DEADMAN_TICK_DISABLED` (tests) and `DEADMAN_TICK_MS`. |

New CLI: `server/src/cli/deadman-tick.ts` → `npm run deadman:tick` (one tick, then exit; for cron).

New env (all optional, documented in README Manual-setup + `server/.env.example`):

| Var | Purpose | Default |
|---|---|---|
| `DEADMAN_TICK_MS` | In-process tick interval (ms). | `60000` |
| `DEADMAN_TICK_DISABLED` | `1` disables the in-process timer (use external cron, or tests). | unset |
| `APP_BASE_URL` | Absolute base URL used to build the links placed in emails (check-in + release). | `http://localhost:5173` |
| `DEADMAN_TEST_MODE` | `1` mounts a test seam to fast-forward a switch's deadline (e2e only; same pattern as `AUTH_TEST_MODE`). | unset |

Frontend additions: `client/src/api/deadmanClient.ts`, a dashboard page, a public view-once page, a
public "checked-in" confirmation page, an onboarding wizard, plus new classes in `styles.css`.

Contract: every feature extends `contracts/openapi.yaml` and regenerates `shared/src/api.ts`
(`npm run gen:api`); shared bounds live in `shared/src/constants.ts`.

---

## 3. Shared data model (all new tables, introduced feature-by-feature)

```sql
-- 008 ─────────────────────────────────────────────────────────────────────
CREATE TABLE deadman_config (
  user_id                  TEXT    PRIMARY KEY REFERENCES user(id),
  enabled                  INTEGER NOT NULL DEFAULT 0,         -- 0/1
  state                    TEXT    NOT NULL DEFAULT 'disarmed',-- disarmed|active|grace|triggered
  checkin_interval_seconds INTEGER NOT NULL,
  grace_period_seconds     INTEGER NOT NULL,
  last_checkin_at          TEXT,                               -- ISO 8601, null until first check-in/arm
  next_checkin_due_at      TEXT,                               -- absolute deadline; survives restarts
  grace_deadline_at        TEXT,                               -- set when entering grace
  reminders_sent           INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT    NOT NULL,
  updated_at               TEXT    NOT NULL
);
CREATE INDEX idx_deadman_state_due ON deadman_config(state, next_checkin_due_at);

CREATE TABLE deadman_event (                                   -- append-only audit log
  id         TEXT NOT NULL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id),
  type       TEXT NOT NULL,   -- armed|disarmed|checkin|entered_grace|reminder_sent|triggered|released|config_changed
  detail     TEXT,            -- JSON; never contains note plaintext
  created_at TEXT NOT NULL
);
CREATE INDEX idx_deadman_event_user ON deadman_event(user_id, created_at);

-- 009 ─────────────────────────────────────────────────────────────────────
ALTER TABLE contact ADD COLUMN verified_at               TEXT;  -- null = unverified
ALTER TABLE contact ADD COLUMN verification_token_hash   TEXT;
ALTER TABLE contact ADD COLUMN verification_expires_at   TEXT;

-- 010 ─────────────────────────────────────────────────────────────────────
CREATE TABLE release (
  id           TEXT NOT NULL PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES user(id),
  trigger      TEXT NOT NULL,            -- schedule|manual_test
  created_at   TEXT NOT NULL
);
CREATE TABLE release_grant (             -- one per recipient; carries the one-time token
  id                  TEXT NOT NULL PRIMARY KEY,
  release_id          TEXT NOT NULL REFERENCES release(id),
  user_id             TEXT NOT NULL REFERENCES user(id),     -- note owner (for decrypt)
  contact_id          TEXT NOT NULL REFERENCES contact(id),
  token_hash          TEXT NOT NULL UNIQUE,
  expires_at          TEXT NOT NULL,
  viewed_at           TEXT,                                  -- set on first open; view-once
  email_status        TEXT NOT NULL DEFAULT 'pending',       -- pending|sent|failed
  provider_message_id TEXT,
  email_error         TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_release_grant_token ON release_grant(token_hash);

-- 011 ─────────────────────────────────────────────────────────────────────
CREATE TABLE checkin_token (
  id         TEXT NOT NULL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_checkin_token_hash ON checkin_token(token_hash);
```

All tokens follow the existing session pattern: a high-entropy random value is shown **once** in a
URL and stored only as a SHA-256 hash; lookups hash the incoming token and compare. Tokens are
time-limited and single-use (`used_at` / `viewed_at`). Plaintext note content is **never** persisted
outside the existing encrypted `note.ciphertext`, never logged, and only materialized in memory at
the moment a valid release-grant link is opened (then discarded).

---

## 4. The five features

### Feature 008 — Liveness engine, check-in & status dashboard  · **P1 (MVP, foundational)**

The core mechanism: a user can configure an interval + grace period, **arm** the switch, see a live
status/countdown, and **check in**. A background tick detects a missed deadline, moves the switch to
`grace`, and sends reminder notifications to the user. (Actual release to contacts is 010; in 008,
grace-expiry transitions to `triggered` and records the event so the engine is complete and testable
end-to-end.)

- **Data**: `deadman_config`, `deadman_event`.
- **Engine**: `deadman/engine.ts` (pure `evaluate` + `runDeadmanTick`), `config-repo.ts`,
  `event-repo.ts`, `driver.ts`; wired into `server.ts` boot (timer) + `cli/deadman-tick.ts`.
- **API**: `GET /api/deadman` (status incl. `secondsUntilDue`), `PUT /api/deadman/config`
  (interval, grace, `enabled` ⇒ arm/disarm), `POST /api/deadman/checkin`.
- **Client**: `deadmanClient.ts`; a dashboard page (state badge, countdown, big "I'm alive"
  check-in button, config form, recent-events list); nav link from the note page.
- **Bounds** (`shared/src/constants.ts`): interval/grace min–max (e.g. interval 1 h–365 d, grace
  1 h–30 d), with a `DEADMAN_TEST_MODE` seam to fast-forward deadlines in e2e.
- **Tests**: engine unit tests (state transitions, tick with injected clock + spy notifier),
  route integration (Supertest), client component tests, e2e (arm → check-in → status).

### Feature 009 — Contact verification  · **P1 (prerequisite for release)**

A contact must prove control of its address before it can ever receive a release. Adds verification
state to contacts and an email round-trip.

- **Data**: `contact.verified_at` + `verification_token_hash` + `verification_expires_at`.
- **API**: `POST /api/contact/{id}/verify` (sends/refreshes a verification email via `notify()`),
  public `GET /api/contact/verify?token=…` (marks verified, single-use, expiring).
- **Client**: ContactList shows a verified/unverified badge + "Send verification"/"Resend"; a public
  verification-result page.
- **Tests**: send + verify happy path, expired/used/invalid token, idempotency; e2e.

### Feature 010 — Release & secure one-time delivery  · **P1**

When the switch fires, create a release: snapshot the **verified** contacts, mint a one-time grant
token per contact, email each a tokenized link, and set the switch to `triggered`. Recipients open
the link once to read the decrypted note; the token then burns.

- **Data**: `release`, `release_grant`.
- **Engine**: extend `runDeadmanTick` — on grace-expiry, create release + grants, send emails,
  transition to `triggered`, record `triggered`/`released` events. **Idempotent** (never double-release).
- **Public routes** (no auth): `GET /api/release/{token}` → decrypt note **once**, mark viewed,
  return content; subsequent opens → `410 Gone`. Fail-closed (`500`) on decrypt failure — never leak.
- **Manual preview**: `POST /api/deadman/test-release` mints a grant to the *owner's own* verified
  address so a user can preview the recipient experience without "dying" (builds trust; used by 012).
- **Client**: public `/r/:token` view-once page (clear "this can only be viewed once" warning).
- **Security**: high-entropy hashed tokens, short TTL, view-once, server-side decrypt only on valid
  token, rate-limited public route, nothing sensitive logged.
- **Tests**: trigger → grants created + emails sent (spy), view-once (second open = 410),
  decrypt-fail closed, idempotent re-tick; full e2e cycle via the test-mode fast-forward seam.

### Feature 011 — Passwordless email check-in links  · **P2**

So a user can stay alive from their inbox: grace reminder emails (from 008) embed a one-time
tokenized link that checks them in without logging in.

- **Data**: `checkin_token`.
- **Wiring**: 008's reminder emails now include a freshly-minted check-in link (per reminder).
- **Public route**: `GET /api/deadman/checkin?token=…` → performs the check-in, single-use/expiring,
  then a confirmation page.
- **Client**: public `/checked-in` confirmation page.
- **Tests**: token check-in resets the clock, expired/used handling, reminder email contains a valid
  link; e2e (miss deadline → reminder → click link → back to active).

### Feature 012 — Onboarding tutorial & guided setup  · **P2/P3 (polish)**

Teach the model and de-risk first use. A first-run experience explains the flow and walks the user
through: write note → add & verify a contact → set interval/grace → arm. Integrates the 010
"send myself a test release" CTA so users can see exactly what their contacts will receive.

- **Client**: first-run detection (no config / never armed) → dismissible, accessible guided wizard;
  an in-app help/explainer; empty-state and countdown polish.
- **Tests**: wizard step component tests; e2e of the first-run path; full accessibility pass
  (keyboard, semantic HTML, WCAG AA) per constitution IV.
- **Docs**: final README Architecture/Run/Manual-setup/Tests updates for the whole suite.

---

## 5. Dependency order & sequencing

```
008 (engine, check-in, dashboard)
 ├─► 009 (contact verification) ──► 010 (release & one-time delivery)
 ├─► 011 (email check-in links)        (needs verified contacts from 009)
 └─► 012 (onboarding) ── ties 008–011 together; depends on all
```

The features touch overlapping files (`server.ts`, `app.ts`, `contracts/openapi.yaml`,
`client/src/App.tsx`, `styles.css`), so they are implemented **strictly sequentially** on one
working branch — no parallel feature work. Each feature ends green
(`npm test` + `npm run typecheck` + `npm run lint`) and is committed as its own bisectable commit
with a `feat:` message, so the set can later be reorganized into the per-feature PRs the constitution
prefers. (Single-branch + per-feature commits is a deliberate, documented compromise vs. five
stacked PRs, to keep the autonomous build tractable; called out here for review.)

---

## 6. Cross-cutting concerns & risks

- **Premature trigger** (worst failure mode): generous default interval/grace, multiple grace
  reminders, two easy check-in paths (dashboard + email link), instant disarm/pause, and a confirm
  step before first arm. The clock is absolute timestamps in the DB, so restarts never "lose time"
  or falsely fire.
- **Secret exposure on release**: verified-contacts-only, one-time tokenized links, short TTL,
  hashed tokens, server-side decrypt only on a valid open, fail-closed on any decrypt error,
  rate-limited public routes, nothing sensitive logged (the 007 stub-debug log stays stub-only).
- **Idempotency / double-fire**: release creation is guarded by switch state + a uniqueness check so
  repeated ticks (in-process timer *and* an external cron together) never double-release.
- **Constitution gates** (every feature): TDD (tests with the code), KISS/YAGNI (no job library, no
  speculative config), typed end-to-end (no `any`), accessible-by-default UI, small reviewable
  commits.
- **Testability of time**: the engine takes an injected `now`; e2e uses `DEADMAN_TEST_MODE` to
  fast-forward a deadline rather than waiting real minutes.

---

## 7. Definition of done (whole roadmap)

A signed-in user can write a note, add and verify a contact, arm the switch with an interval and
grace period, see a live countdown, check in from the dashboard or an email link, and — if they go
silent past the grace period — have each verified contact automatically receive an email whose
one-time link reveals the note exactly once. First-time users are guided through this end to end and
can preview the recipient experience safely. All four README sections reflect the new run/setup/test
reality, and `npm test`, `npm run typecheck`, and `npm run lint` pass.
