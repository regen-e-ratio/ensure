# Feature Specification: Passwordless Email Check-In Links

**Feature Branch**: `011-email-checkin-links`

**Created**: 2026-06-20

**Status**: Draft

**Input**: User description: "Let a user stay alive from their inbox. Feature 008's grace reminder emails
now mint a fresh one-time check-in token per reminder and embed an `APP_BASE_URL/checkin?token=<token>`
(equivalently `/api/deadman/checkin?token=`) link. A public, no-auth `GET /api/deadman/checkin?token=…`
hashes the supplied token, looks the check-in token up by hash, and — only when it is valid, unused, and
unexpired — performs the check-in (reset `last_checkin_at`/`next_checkin_due_at`, state back to `active`,
clear grace bookkeeping/reminders, record a `checkin` event), marks the token used (single-use), and
returns a confirmation; an already-used/expired/unknown/malformed token yields a generic not-available
result disclosing nothing. The token follows the existing hashed-token pattern (high-entropy random value
shown once in the link, only its SHA-256 hash stored, looked up by hashing the incoming token, time-limited
and single-use, constant-time compare) and reuses the `tokens.ts` helper from feature 010. A new
`checkin_token` table (roadmap §3) backs it. The client gets a public `/checked-in` confirmation page,
registered outside `ProtectedRoute`. The OpenAPI contract gains the public path and is regenerated into
`shared/src/api.ts`."

## Clarifications

### Session 2026-06-20

- Q: Who mints the check-in token and when? → A: The **engine tick** mints a fresh token **per reminder**.
  Feature 008's `enterGrace` (first reminder) and `sendReminder` (subsequent reminders) each mint a new
  high-entropy check-in token, persist **only its SHA-256 hash** in `checkin_token` with a future
  `expires_at`, and embed the raw token exactly once in the reminder email body as an
  `APP_BASE_URL/checkin?token=<token>` link. Every reminder carries its **own** fresh link.
- Q: Is the check-in endpoint authenticated? → A: **No.** `GET /api/deadman/checkin?token=…` is public (no
  session). The recipient is the owner reading their own inbox; possession of the unguessable token is the
  sole authority. The endpoint reads **no** session, user id, or caller-supplied id — it derives the user
  from the token's `checkin_token` row (which carries `user_id`).
- Q: What is the token's lifetime and is it single-use? → A: **Single-use** (consumed by setting `used_at`
  on the first successful check-in) and **time-limited** (a `CHECKIN_TOKEN_TTL_SECONDS` window from mint;
  default ties to the switch's grace window so a link is live for as long as a reminder is actionable).
  After use **or** expiry the link is dead and yields a generic not-available result.
- Q: How is the token stored and compared? → A: The raw token appears **only once**, inside the emailed
  `APP_BASE_URL/checkin?token=<token>` link; the database stores only its SHA-256 hash (`token_hash`).
  Opening hashes the incoming token and looks the row up by hash (mirroring the session/refresh-token,
  contact-verification, and release-grant patterns), reusing feature 010's `deadman/tokens.ts`
  (`mintToken`/`hashToken`/`compareToken`). The raw token is never stored, logged, or echoed.
- Q: What does the check-in actually do? → A: Exactly what the authed dashboard check-in does (it reuses
  `recordCheckin`): set `last_checkin_at` = now, reset `next_checkin_due_at` = now + interval, return the
  switch to `active`, clear `grace_deadline_at` and `reminders_sent`, and record a `checkin` event. From
  the engine's perspective the switch is alive again and the clock has reset.
- Q: What if the switch is no longer in a checkable state when the link is opened (already triggered, or
  disarmed)? → A: The check-in succeeds **only** when the switch is `active` or `grace` (the states the
  dashboard check-in already allows). A link opened after the switch has fired (`triggered`) or been
  disarmed yields a generic not-available result and does **not** reset the clock — but the token is still
  consumed (marked used) so it cannot be replayed.
- Q: Does opening the link reveal anything sensitive? → A: No. The confirmation page and the endpoint
  response carry **no** note plaintext, no contact data, and no token — only a check-in outcome. The
  reminder email body likewise carries no secret beyond the one-time link (consistent with feature 008's
  no-secrets reminder, FR-017).
- Q: How does this interact with the existing dashboard check-in? → A: It is an **additional** check-in
  path, not a replacement. A user may check in from the dashboard (authed `POST /api/deadman/checkin`,
  feature 008) **or** from any unexpired, unused reminder link. Both reset the same clock; the first to
  fire wins and any other outstanding reminder link simply finds the switch already `active` (still a
  valid check-in if still `active`, or a no-op-but-consumed token otherwise).

## User Scenarios & Testing *(mandatory)*

<!--
  User stories are prioritised, independently testable journeys. US1 is the core passwordless check-in: a
  valid reminder link resets the clock back to active without signing in. US2 is the token lifecycle —
  expired/used/unknown/malformed links fail closed and never reset the clock. US3 is the wiring: a generated
  reminder email actually contains a working check-in link. US4 is the public confirmation page.
-->

### User Story 1 - Stay alive from the inbox (Priority: P1)

A user whose switch has slipped into its grace period receives a reminder email with a one-time check-in
link. They open the link — without signing in — and their switch is checked in: the clock resets, the
state returns to `active`, grace bookkeeping clears, and a `checkin` event is recorded. They see a clear
confirmation that they have been checked in.

**Why this priority**: This is the feature's whole point — the lowest-friction way to prevent a premature
trigger. A user who can't get to the dashboard (travelling, on a phone, no password handy) can still stay
alive in one tap from their inbox, directly reducing the worst failure mode (a false fire).

**Independent Test**: Mint a check-in token for a user whose switch is in `grace` (via the reminder flow or
the token repo), call `GET /api/deadman/checkin?token=<raw>`, and assert the switch is now `active`,
`next_checkin_due_at` has been reset to now + interval, `grace_deadline_at`/`reminders_sent` are cleared, a
`checkin` event was recorded, and the token's `used_at` is set. The endpoint returns a success
confirmation.

**Acceptance Scenarios**:

1. **Given** an armed switch in `grace` with a valid, unused, unexpired check-in token, **When** the public
   `GET /api/deadman/checkin?token=<raw>` is called (no sign-in), **Then** the switch transitions back to
   `active`, `next_checkin_due_at` is reset to now + interval, `grace_deadline_at` and `reminders_sent` are
   cleared, a `checkin` event is recorded, the token is marked used, and a success confirmation is returned.
2. **Given** an armed switch in `active` (a reminder link opened before the next deadline), **When** the
   link is opened, **Then** the check-in still succeeds (clock reset, `checkin` event recorded, token
   consumed) — opening early is always safe.
3. **Given** a successful check-in, **When** the audit log is inspected, **Then** a `checkin` event exists
   whose detail carries only non-sensitive metadata (e.g. the new `nextCheckinDueAt`) and never a token or
   any note plaintext.
4. **Given** a successful check-in, **When** the switch state is later evaluated by the engine, **Then** it
   behaves exactly as if the user had checked in from the dashboard (no reminder is due, no trigger).

---

### User Story 2 - Token lifecycle: expired, used, and invalid links (Priority: P1)

A check-in link works exactly once and only for a limited time. A link that has already been used, has
expired, is unknown, or is malformed does nothing to the switch and reveals nothing — it shows a generic
"link no longer available" outcome.

**Why this priority**: The security core. A replayable or long-lived check-in link would let anyone who
ever saw a reminder email keep a switch alive forever (defeating the dead-man guarantee), so single-use +
short TTL + fail-closed + non-disclosure are as important as the happy path.

**Independent Test**: For a `grace` switch, open a valid token once (succeeds, US1), then open the **same**
token again and assert a generic not-available result with the switch **unchanged** by the second call;
advance time past the token's `expires_at` for a fresh token and assert not-available with no clock reset;
open an unknown and a malformed token and assert the same generic not-available result; in each failure
case assert no `checkin` event was recorded and `next_checkin_due_at` was not changed.

**Acceptance Scenarios**:

1. **Given** a check-in token already consumed by a prior successful check-in, **When** the same link is
   opened again, **Then** the endpoint returns a generic not-available result and the switch is unchanged
   (no second clock reset, no extra `checkin` event).
2. **Given** a check-in token whose `expires_at` is now in the past, **When** the link is opened, **Then**
   the endpoint returns a generic not-available result, `used_at` is **not** set, and the clock is not
   reset.
3. **Given** a missing, malformed, or unknown token, **When** the link is opened, **Then** the endpoint
   returns the same generic not-available result, disclosing nothing about whether any token, switch, or
   user exists (no enumeration).
4. **Given** a valid token whose switch has since fired (`triggered`) or been disarmed, **When** the link
   is opened, **Then** the check-in does **not** reset the clock (the switch stays as it is), the result is
   a generic not-available, and the token is consumed so it cannot be replayed.
5. **Given** any failure path, **When** the audit log and the switch row are inspected, **Then** no
   `checkin` event was recorded and `last_checkin_at`/`next_checkin_due_at` are unchanged.

---

### User Story 3 - A reminder email carries a working check-in link (Priority: P1)

Every grace reminder the engine sends (the first on entering grace, and each subsequent one up to the cap)
mints a fresh one-time check-in token, persists only its hash, and embeds an
`APP_BASE_URL/checkin?token=<token>` link in the email body — and that exact link, opened, performs a real
check-in.

**Why this priority**: Without the wiring, US1/US2 are unreachable in practice. This story proves the link
the user actually receives is the one the endpoint accepts, end to end, and that no reminder leaks a secret.

**Independent Test**: Drive the engine into `grace` for a user (injected clock + a spy notifier), capture
the reminder message, assert its body contains exactly one `APP_BASE_URL/checkin?token=<token>` link, then
extract the raw token from the link and call `GET /api/deadman/checkin?token=<token>` and assert the switch
is checked in (US1 outcome). Assert each reminder (first + subsequent) carries its **own** fresh link, and
that the body contains no token hash, note plaintext, or other secret.

**Acceptance Scenarios**:

1. **Given** an `active` switch whose check-in deadline has lapsed, **When** the engine ticks and enters
   grace, **Then** the first reminder email body contains exactly one `APP_BASE_URL/checkin?token=<token>`
   link, and a `checkin_token` row storing only that token's hash (with a future `expires_at`) was created.
2. **Given** a switch already in grace under the reminder cap, **When** the engine ticks again, **Then** the
   next reminder email carries a **fresh** check-in link backed by a new `checkin_token` row (the previous
   link still works until used/expired, but each reminder mints its own).
3. **Given** a captured reminder email, **When** the embedded link is opened, **Then** the switch is checked
   in exactly as in US1 (the link the user receives is the link the endpoint accepts).
4. **Given** any reminder email, **When** its body is inspected, **Then** it contains no token hash, no note
   plaintext, and no secret beyond the one-time link (FR-017 carried over from feature 008).
5. **Given** the engine fails to mint or persist a check-in token for a reminder, **When** the tick runs,
   **Then** the failure is handled without aborting the batch (the reminder/grace handling degrades safely
   and other users still process), consistent with feature 008's per-user failure isolation.

---

### User Story 4 - The public confirmation page (Priority: P2)

After opening a check-in link, the user lands on an accessible public `/checked-in` page that clearly
confirms they have been checked in (clock reset) — or, for an already-used/expired/invalid link, clearly
states the link is no longer available — without requiring a session.

**Why this priority**: The endpoint delivers the value, but a clear, accessible confirmation closes the
loop and reassures the user they are safe for another interval. It is the visible payoff of the link, but
the check-in itself (US1) is what prevents the trigger, so it ranks just below the core paths.

**Independent Test**: Render the `/checked-in` page with a token that checks in successfully and assert a
clear "you're checked in" confirmation (and ideally the next deadline) is shown via an accessible live
region; render it with an already-used/expired/invalid token and assert a clear "link no longer available"
message; assert the page is keyboard-reachable, uses semantic markup with no colour-only signalling, and is
reachable without a session.

**Acceptance Scenarios**:

1. **Given** a valid, unused, unexpired check-in token, **When** the `/checked-in?token=<token>` page loads,
   **Then** it calls the public endpoint, the switch is checked in, and the page shows a prominent
   confirmation that the user has been checked in (announced via an accessible live region).
2. **Given** an already-used, expired, unknown, or malformed token, **When** the page loads, **Then** it
   shows a clear "this link is no longer available" message (not a confirmation), using semantic, accessible
   markup.
3. **Given** a server/network error, **When** the page loads, **Then** it shows a generic error message and
   does not falsely claim a successful check-in.
4. **Given** any of the above, **When** the page renders, **Then** it is keyboard-reachable, uses a semantic
   heading + live region, relies on no colour alone, and is reachable without a session (registered outside
   `ProtectedRoute`) — mirroring `ContactVerifiedPage`/`ReleaseViewPage`.

---

### Edge Cases

- **Single-use / replay**: A token is consumed when `used_at` is set on the first successful check-in;
  re-opening the same link returns a generic not-available result and never resets the clock a second time.
- **Expired token**: `now >= expires_at` (inclusive) returns a generic not-available result and does not set
  `used_at` or reset the clock.
- **Unknown / malformed token**: A missing, malformed, or non-matching token yields the same generic
  not-available result, disclosing nothing about token/switch/user existence (no enumeration).
- **Switch no longer checkable**: A valid token whose switch is now `triggered` or `disarmed` does not reset
  the clock (generic not-available), but the token is consumed so it cannot be replayed once the switch is
  back in a checkable state.
- **Early open**: Opening a reminder link while the switch is still `active` (before the next deadline)
  still checks in safely — an early check-in is always allowed.
- **Multiple outstanding links**: Each reminder mints its own token; once one link checks the user in (back
  to `active`), the others still resolve as valid check-ins while `active` or as consumed-no-op once used —
  none can ever over-reset or corrupt the clock.
- **Token never logged**: No log line, event detail, email body, or API/page response ever contains a raw
  check-in token or its hash beyond the single emailed link; only the SHA-256 hash is persisted.
- **Idempotency vs. the dashboard**: A reminder link and the authed dashboard check-in reset the same
  clock; whichever fires first wins, and the other resolves without harm.
- **No secret in the email**: The reminder body carries only the one-time link — no note plaintext, no
  contact data, no token hash (FR-017 from feature 008 preserved).
- **TTL alignment**: A check-in token's TTL is bounded so a link cannot outlive its usefulness (it should
  not remain valid long after the grace window/trigger), preventing a stale link from resetting a
  re-armed switch.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each grace reminder the engine sends (the first on `enterGrace`, and each subsequent
  `sendReminder` up to the cap) MUST mint a fresh high-entropy check-in token, persist **only** its SHA-256
  hash in a new `checkin_token` row with the owning `user_id` and a future `expires_at`, and embed the raw
  token exactly once in the reminder email body as an `APP_BASE_URL/checkin?token=<token>` link.
- **FR-002**: The check-in token MUST follow the existing hashed-token pattern via feature 010's shared
  `deadman/tokens.ts` (`mintToken` = high-entropy random; `hashToken` = SHA-256; `compareToken` =
  constant-time): the raw token is shown once in the link, only its hash is stored, lookups hash the
  incoming token and compare against the stored hash, and the raw token MUST never be stored, logged, or
  echoed.
- **FR-003**: The system MUST expose a **public** (no-auth) `GET /api/deadman/checkin?token=…` endpoint that
  hashes the supplied token, looks the `checkin_token` row up by hash, derives the user from that row (no
  caller-supplied user id, no session), and performs a check-in **only** when the token is valid, unused
  (`used_at` is null), and unexpired (`now < expires_at`).
- **FR-004**: On a valid, unused, unexpired token whose switch is `active` or `grace`, the endpoint MUST
  perform the check-in (reuse `recordCheckin`): set `last_checkin_at` = now, reset `next_checkin_due_at` =
  now + interval, return the switch to `active`, clear `grace_deadline_at` and `reminders_sent`, and record
  a `checkin` event; it MUST then mark the token used (`used_at` = now, single-use) and return a success
  confirmation.
- **FR-005**: The endpoint MUST be **single-use**: marking the token used MUST consume it atomically so a
  concurrent or replayed open resets the clock at most once; a second open of the same token MUST return a
  generic not-available result and MUST NOT record a second `checkin` event or reset the clock again.
- **FR-006**: The endpoint MUST **fail closed and non-disclosing**: an already-used, expired, unknown, or
  malformed token MUST return the same generic not-available result, disclosing nothing about whether any
  token, switch, or user exists, and MUST NOT reset the clock or record a `checkin` event.
- **FR-007**: A valid token whose switch is no longer checkable (`triggered` or `disarmed`) MUST NOT reset
  the clock; the endpoint MUST return a generic not-available result while still consuming the token so it
  cannot be replayed.
- **FR-008**: The reminder email body MUST carry no secret beyond the one-time check-in link — no note
  plaintext, no contact data, no token hash — preserving feature 008's no-secrets reminder guarantee
  (FR-017).
- **FR-009**: A failure to mint or persist a check-in token for one user's reminder MUST NOT abort the
  engine tick batch; it MUST be handled with feature 008's per-user failure isolation (other users still
  process), and MUST NOT leak a token or secret into any recorded marker.
- **FR-010**: A check-in token MUST be **time-limited** by a shared `CHECKIN_TOKEN_TTL_SECONDS` (in
  `shared/src/constants.ts`) bounded so a link does not outlive its usefulness (it should not remain valid
  long after the grace window/trigger); the same constant MUST be used by the minting engine and any TTL
  assertions so client and server agree.
- **FR-011**: The OpenAPI contract (`contracts/openapi.yaml`) MUST be the source of truth for the new public
  `GET /api/deadman/checkin` path (a `token` query param, no `security`) and its `CheckinLinkResult`
  response/`Error` responses, and `shared/src/api.ts` MUST be regenerated via `npm run gen:api`
  (never hand-edited).
- **FR-012**: The client MUST provide a **public** `/checked-in` confirmation page that reads the `token`
  query param, calls the public endpoint on mount (guarding React 18 StrictMode's double-effect so the
  single-use token is not consumed twice), and renders a clear "you're checked in" confirmation on success,
  a "no longer available" message for an already-used/expired/invalid link, and a generic error otherwise —
  with semantic, keyboard-accessible markup (no colour-only signalling), reachable without a session and
  registered outside `ProtectedRoute` in `client/src/App.tsx`.
- **FR-013**: The check-in token table (`checkin_token`) MUST be created in `openDb()`
  (`server/src/db/index.ts`) per roadmap §3 (`id`, `user_id`, `token_hash` UNIQUE, `expires_at`, `used_at`,
  `created_at`, plus `idx_checkin_token_hash`), and MUST be wiped in the existing test-reset/`clearDeadman`
  path so e2e runs start clean.
- **FR-014**: All check-in handling MUST keep note plaintext and tokens out of every persisted artifact and
  every response: the only thing persisted is the token's SHA-256 hash; no token, hash, or note plaintext
  ever appears in a log line, an event detail, an email body (beyond the one-time link), or an
  endpoint/page response.

### Key Entities *(include if feature involves data)*

- **Check-in token (`checkin_token`)**: One row per reminder-minted check-in link. Carries the owning
  `user_id` (so the public endpoint derives the user without a session), the one-time token's SHA-256
  `token_hash` (UNIQUE; the raw token is never stored), an absolute `expires_at`, a nullable `used_at` (set
  on first successful check-in; single-use), and `created_at`. The public open path reaches a row only via
  the token hash, never via a caller-supplied id. Backed by `idx_checkin_token_hash` on `token_hash`.
- **Check-in token (transient)**: A high-entropy random value, surfaced exactly once inside the emailed
  `APP_BASE_URL/checkin?token=<token>` link. Only its SHA-256 hash and expiry are persisted (on the
  `checkin_token` row). It is single-use (consumed when `used_at` is set) and time-limited.
- **Dead-man config (`deadman_config`)**: The per-user switch from feature 008. The public check-in reuses
  `recordCheckin` to reset `last_checkin_at`/`next_checkin_due_at`, return the state to `active`, and clear
  grace bookkeeping. This feature reads/resets the switch but adds no new column to it.
- **Dead-man event (`deadman_event`)**: The append-only audit log from feature 008. A successful link
  check-in records the existing `checkin` event (non-sensitive detail only); no new event type is added.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Opening a valid, unused, unexpired check-in link resets the clock in 100% of cases — the
  switch returns to `active`, `next_checkin_due_at` is set to now + interval, grace bookkeeping is cleared,
  a `checkin` event is recorded, and the token is marked used — without any sign-in.
- **SC-002**: A second open of an already-used link, and any open of an expired link, resets the clock in
  **0** cases (single-use + TTL proven by re-opening and by advancing time), each returning the generic
  not-available result.
- **SC-003**: 100% of unknown/malformed/used/expired tokens return the **same** generic not-available result
  that discloses nothing about token/switch/user existence (no enumeration), and record **0** `checkin`
  events.
- **SC-004**: Every grace reminder email contains exactly one `APP_BASE_URL/checkin?token=<token>` link
  backed by a `checkin_token` row that stores only the token's hash, and that exact link, opened, performs a
  real check-in in 100% of cases (the link received is the link the endpoint accepts).
- **SC-005**: The raw check-in token and its hash appear in **0** log lines, **0** events, **0** email
  bodies beyond the single one-time link, and **0** endpoint/page responses across the test suite (only the
  SHA-256 hash is persisted, only the raw token is in the link).
- **SC-006**: A valid token whose switch is `triggered`/`disarmed` resets the clock in **0** cases while
  still being consumed (replay-proof), verified by opening such a link and asserting the switch is unchanged
  and the token is now used.
- **SC-007**: The `/checked-in` page renders a clear confirmation on success and a clear "no longer
  available" message otherwise, is keyboard-reachable and screen-reader-announceable (WCAG AA, no
  colour-only signalling), verified by component/e2e a11y assertions, and is reachable without a session.
- **SC-008**: A full e2e cycle (arm → fast-forward miss → grace → reminder email captured → open the
  embedded check-in link → switch back to `active`) passes with the in-process timer disabled
  (`DEADMAN_TICK_DISABLED=1`), proving the inbox check-in path end to end.

## Assumptions

- **Engine + reminders exist**: Feature 008's liveness engine (`runDeadmanTick`, `evaluate`, `enterGrace`,
  `sendReminder`, the injected `Deps` with clock + notifier, per-user failure isolation, and the
  `DEADMAN_MAX_GRACE_REMINDERS` cap) already exists; this feature **extends** the reminder send to mint a
  token and embed a link, and adds the public check-in endpoint. The `recordCheckin` reset and the `checkin`
  event already exist (feature 008) and are reused unchanged.
- **Shared token helper exists**: Feature 010's `server/src/deadman/tokens.ts` (`mintToken`/`hashToken`/
  `compareToken`) already exists and is **reused** for check-in tokens — no new crypto and no new token
  module are introduced.
- **`APP_BASE_URL` is available**: The optional `APP_BASE_URL` env var/`appBaseUrl` (feature 008, read where
  `EMAIL_PROVIDER` is read) is reused to build the absolute `/checkin?token=<token>` link in the reminder
  email; its default is `http://localhost:5173`. No new env var is introduced.
- **Email dispatcher exists**: Reminder emails are sent through the generic `notify()` dispatcher + email
  channel (features 005/008); this feature only changes the reminder **body** (to add the link) and adds no
  new provider.
- **Public-route + page patterns exist**: The public, token-only route pattern (mounted before
  `requireAuth`) from features 009/010 and the public confirmation-page pattern (`ContactVerifiedPage`,
  `ReleaseViewPage`, registered outside `ProtectedRoute`) are reused for the new endpoint and page.
- **Test seams exist**: The `DEADMAN_TEST_MODE` fast-forward seam (`POST /api/test/deadman`), the capturing
  email provider, and `DEADMAN_TICK_DISABLED=1` (so the in-process timer never runs in tests) from features
  008/009/010 are reused to drive a full e2e cycle (arm → miss → reminder → open link → active) without
  waiting real time.
- **No new external service**: This feature adds one public endpoint, one table, one shared TTL constant,
  and one confirmation page — but **no** new env var or external service (it reuses `APP_BASE_URL`, the
  email channel, the token helper, and `recordCheckin`).

## Dependencies

- Feature 008's liveness engine and reminder send (`enterGrace`/`sendReminder` in `deadman/engine.ts`,
  driven by the injected `Deps`), the `recordCheckin` reset + `checkin` event (`deadman/config-repo.ts` +
  `event-repo.ts`), the `DEADMAN_MAX_GRACE_REMINDERS` cap, and per-user failure isolation — all extended/
  reused here.
- Feature 010's shared `server/src/deadman/tokens.ts` (`mintToken`/`hashToken`/`compareToken`), reused for
  check-in tokens (the same hashed-token pattern).
- The `APP_BASE_URL`/`appBaseUrl` configuration (feature 008) to build the absolute `/checkin?token=<token>`
  link in the reminder email.
- The notification dispatcher + email channel (features 005/008) to send the reminder carrying the link.
- The public token-only route pattern + public confirmation-page pattern (features 009/010) for the new
  endpoint and `/checked-in` page.
- The OpenAPI contract (`contracts/openapi.yaml`) + generated `shared/src/api.ts`, and the shared
  `CHECKIN_TOKEN_TTL_SECONDS` in `shared/src/constants.ts`, as the single typed contract across client and
  server.
- The `DEADMAN_TEST_MODE` fast-forward seam, the capturing email provider, and `DEADMAN_TICK_DISABLED=1`
  (features 008/009/010) for the full e2e check-in-link cycle.
