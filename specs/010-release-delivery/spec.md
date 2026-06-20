# Feature Specification: Release & Secure One-Time Delivery

**Feature Branch**: `010-release-delivery`

**Created**: 2026-06-20

**Status**: Draft

**Input**: User description: "When the switch fires, securely deliver the note to VERIFIED contacts via
one-time tokenized links. On grace-expiry the engine creates a release, snapshots the user's verified
contacts only, mints one grant token per contact, and emails each contact a tokenized link (via the
generic notify() dispatcher) explaining a message awaits them plus an `APP_BASE_URL/r/<token>` link; it
records a per-grant email status, transitions the switch to `triggered`, and records `triggered` +
`released` events. Release creation MUST be idempotent — never a second release for an already-triggered
cycle — so the in-process timer and an external cron can't double-fire. A public, no-auth
`GET /api/release/{token}` hashes and looks up the grant; if valid, not viewed, and not expired it
decrypts the owner's note via the keyring, marks `viewed_at`, and returns the content exactly once;
already-viewed/expired links return `410 Gone`; a decrypt failure fails closed with `500` and never
leaks. The route is rate-limited. An authed `POST /api/deadman/test-release` mints a grant to the
owner's own verified contact address so a user can preview the recipient experience without triggering
for real. The client gets a public `/r/:token` view-once page with a clear 'this can only be opened
once' warning that renders the note text. This consumes the verified flag from feature 009 — only
verified contacts ever receive a one-time release link."

## Clarifications

### Session 2026-06-20

- Q: Which contacts receive a release? → A: **Only verified contacts** (feature 009's
  `verified_at != null`). The release snapshots the user's verified contacts at the moment it is created;
  unverified contacts are skipped entirely and never get a grant or an email. A user with zero verified
  contacts still produces a release (with no grants) and still transitions to `triggered`.
- Q: What is the grant token's lifetime and is it single-use? → A: A grant token is **single-use**
  (consumed when `viewed_at` is set on first open) and **time-limited** (a `RELEASE_GRANT_TTL_SECONDS`
  window from mint; default 30 days, so a contact who is slow to check email still gets one read).
  After view-once **or** expiry the link is dead and returns `410 Gone`.
- Q: How is the token stored and compared? → A: The raw grant token appears **only once**, inside the
  emailed `APP_BASE_URL/r/<token>` link; the database stores only its SHA-256 hash (`token_hash`).
  Opening hashes the incoming token and looks the grant up by hash (mirroring the
  session/refresh-token and contact-verification patterns). The raw token is never stored, logged, or
  echoed.
- Q: Is the public release endpoint authenticated? → A: No. `GET /api/release/{token}` is public (no
  session) because the recipient is a contact, not necessarily an Ensure user. Authority comes entirely
  from possession of the unguessable token; no contact id, owner id, or session is read from the caller.
- Q: How is double-firing prevented? → A: Release creation is **idempotent** and guarded on switch
  **state plus an existing-release check**: a switch already in `triggered`, or one for which a release
  already exists for the current triggered cycle, never produces a second release. So the in-process
  60 s timer and an external cron running together can never double-release.
- Q: What happens when the note can't be decrypted on open? → A: The route **fails closed** with `500`
  and returns no content — it never emits partial or fallback plaintext (consistent with the
  fail-closed note read path). `viewed_at` is **not** set on a decrypt failure, so the (rare) failure is
  retryable rather than burning the single view.
- Q: What does a triggered user (the owner) see? → A: The switch state becomes `triggered` and a
  `released` audit event is recorded (with non-sensitive metadata only: a grant count, never note
  plaintext or any token). The release/grant rows are internal; the dashboard's existing state badge and
  events list reflect the trigger. No note plaintext or token ever appears in an event or response.
- Q: How does the test-release preview differ from a real release? → A: `POST /api/deadman/test-release`
  is authed and scoped to `req.user.id`. It creates a release tagged `trigger: "manual_test"`, mints a
  grant **only to the owner's own verified contact address(es)**, emails the tokenized link, and does
  **not** change the switch state. The recipient experience is identical (same `/r/<token>` view-once
  page), so a user can safely preview without "dying".

## User Scenarios & Testing *(mandatory)*

<!--
  User stories are prioritised, independently testable journeys. US1 is the core release: a fired switch
  snapshots verified contacts, mints grants, emails tokenized links, and flips to triggered, idempotently.
  US2 is the recipient experience: opening a valid link once reveals the note and burns the token (view-once,
  fail-closed). US3 is the safe self-preview without triggering for real. US4 is the client view-once page.
-->

### User Story 1 - A fired switch releases the note to verified contacts (Priority: P1)

When a user's switch lapses past its grace period, the engine fires it: it creates a release, snapshots
**only the verified contacts**, mints a one-time grant token per contact, emails each contact a
tokenized link explaining a message awaits them, records each grant's email status, transitions the
switch to `triggered`, and records `triggered` + `released` events. Re-running the engine (the
in-process timer and an external cron together) never creates a second release.

**Why this priority**: This is the whole point of the dead-man switch — the silent owner's note reaches
their chosen people. Without it features 008/009 deliver no payload. The smallest valuable slice is
"grace lapses → verified contacts get tokenized links → switch is triggered, once".

**Independent Test**: Arm a switch for a user who has both a verified and an unverified contact, drive
the engine past the grace deadline (injected clock), and assert: a `release` row exists, exactly one
`release_grant` exists (for the verified contact only), a tokenized `APP_BASE_URL/r/<token>` email was
dispatched through a **spy notifier** to the verified contact's address, the grant's `email_status` is
`sent`, the switch state is `triggered`, and `triggered` + `released` events were recorded. Run the tick
again and assert **no** second release or grant is created.

**Acceptance Scenarios**:

1. **Given** an armed switch whose grace deadline has lapsed and whose owner has one verified and one
   unverified contact, **When** the engine ticks, **Then** a single `release` is created, exactly one
   `release_grant` is minted (for the verified contact), a tokenized link email is sent via the generic
   `notify()` dispatcher to the verified contact, and the switch transitions to `triggered`.
2. **Given** the same fired switch, **When** the engine ticks **again** (or an external cron runs
   concurrently), **Then** no second release and no additional grants are created (idempotent — guarded
   on state + existing release), and the switch remains `triggered`.
3. **Given** a fired switch whose owner has **no** verified contacts, **When** the engine ticks, **Then**
   the switch still transitions to `triggered`, a release is recorded with zero grants, no email is sent,
   and a `released` event (grant count 0) is recorded.
4. **Given** a release is created, **When** the audit log is inspected, **Then** `triggered` and
   `released` events exist whose detail carries only non-sensitive metadata (e.g. a grant count) and
   never note plaintext or any token value.
5. **Given** the email send for one grant fails, **When** the engine processes the release, **Then** that
   grant's `email_status` is recorded as `failed` (with a non-sensitive error), other grants are still
   sent, and the release/trigger still completes (one failure never aborts the batch).

---

### User Story 2 - A contact opens the link once to read the note (Priority: P1)

A contact receives the email, opens the `APP_BASE_URL/r/<token>` link, and — for a valid, unviewed,
unexpired token — sees the owner's decrypted note **exactly once**. The token then burns: opening the
same link again, or an expired link, shows that it is no longer available. A decrypt failure reveals
nothing.

**Why this priority**: The release is only meaningful if a recipient can actually read the note, and the
view-once + fail-closed guarantees are the security core — a replayable or leaky link would defeat the
app's encrypt-at-rest design.

**Independent Test**: Create a grant (via the US1 flow or repo), then call `GET /api/release/{token}`
with the raw token and assert the decrypted note text is returned **once** and `viewed_at` is set; call
it again and assert `410 Gone` with no content; advance time past the grant expiry and assert `410 Gone`;
force a decrypt failure (e.g. retire the key version) and assert `500` with no plaintext and `viewed_at`
left unset.

**Acceptance Scenarios**:

1. **Given** a valid, unviewed, unexpired grant token, **When** the public release endpoint is called
   (no sign-in), **Then** the owner's note is decrypted server-side via the keyring, `viewed_at` is set
   to now, and the note text is returned exactly once.
2. **Given** a grant token that has already been viewed, **When** the link is opened again, **Then** the
   endpoint returns `410 Gone` and no note content (view-once).
3. **Given** a grant token whose `expires_at` is now in the past, **When** the link is opened, **Then**
   the endpoint returns `410 Gone` and `viewed_at` is not set.
4. **Given** a missing, malformed, or unknown grant token, **When** the link is opened, **Then** the
   endpoint returns a generic not-available result (`404`/`410`) that discloses nothing about whether any
   release, grant, or owner exists.
5. **Given** a valid grant whose owner's note cannot be decrypted (key version absent or auth tag fails),
   **When** the link is opened, **Then** the endpoint **fails closed** with `500`, returns no plaintext
   or partial content, and does **not** set `viewed_at` (the rare failure is retryable, not a burned
   view).
6. **Given** the public release route, **When** it is called repeatedly in a short window, **Then**
   excessive requests are **rate-limited** (a guessing/scraping client is throttled) without affecting a
   normal single open.

---

### User Story 3 - Preview the recipient experience without triggering (Priority: P2)

Before trusting the switch, a signed-in user sends themselves a test release: a grant to their **own
verified contact address**, delivered exactly as a real release would be, so they can open the
`/r/<token>` view-once page and see precisely what their contacts will receive — without the switch
firing or changing state.

**Why this priority**: This builds trust and de-risks first use (it is the CTA feature 012 integrates),
but the real release (US1) and the recipient read path (US2) deliver the core value first.

**Independent Test**: As a signed-in user with a verified contact, call
`POST /api/deadman/test-release` and assert a release tagged `manual_test` is created, a grant to the
owner's own verified address is minted, a tokenized link email is dispatched via the **spy notifier**,
and the switch state is **unchanged** (not `triggered`); then open the grant link once and assert the
note renders, exactly as a real release.

**Acceptance Scenarios**:

1. **Given** a signed-in user with at least one verified contact, **When** they request a test release,
   **Then** a release tagged `manual_test` is created, one grant per owner-verified contact is minted, a
   tokenized link email is sent to each via the generic dispatcher, and the response indicates success.
2. **Given** a test release, **When** the switch state is inspected before and after, **Then** it is
   **unchanged** (a preview never arms, triggers, or alters the switch).
3. **Given** a signed-in user with **no** verified contacts, **When** they request a test release,
   **Then** the request is rejected with a clear error (nothing to preview) and no email is sent.
4. **Given** a visitor who is not signed in, **When** they call `POST /api/deadman/test-release`,
   **Then** the request is rejected with `401` and no release or email is created.
5. **Given** a test-release grant link, **When** the owner opens it once, **Then** the note renders
   exactly as a real release would (same view-once page, same burn-on-open behaviour).

---

### User Story 4 - The public view-once recipient page (Priority: P1)

A recipient opening the link lands on an accessible public page that clearly warns the note **can only be
opened once**, then renders the note text (or a clear "no longer available" message for an
expired/already-viewed link, or a generic error on failure).

**Why this priority**: The recipient is typically not an Ensure user; a clear, accessible, unambiguous
view-once page is required for the delivery to be usable and trustworthy. It pairs with US2's endpoint to
complete the recipient journey.

**Independent Test**: Render the `/r/:token` page with a token that resolves to a note and assert the
note text and a prominent single-use warning are shown; render it with an already-viewed/expired token
and assert a clear "no longer available" message; assert the page is keyboard-reachable and announces its
state via semantic, accessible markup (no colour-only signalling), reachable without a session.

**Acceptance Scenarios**:

1. **Given** a valid first-open token, **When** the `/r/:token` page loads, **Then** it shows a prominent
   "this can only be opened once" warning and renders the decrypted note text.
2. **Given** an already-viewed or expired token, **When** the page loads, **Then** it shows a clear "this
   link is no longer available" message (not the note), using semantic, accessible markup.
3. **Given** a server error/decrypt failure, **When** the page loads, **Then** it shows a generic error
   message and never any partial note content.
4. **Given** any of the above, **When** the page renders, **Then** it is keyboard-reachable, uses a
   semantic heading + live region, relies on no colour alone, and is reachable without a session
   (registered outside `ProtectedRoute`).

---

### Edge Cases

- **Idempotent re-tick / double-fire**: Two ticks (or the timer + an external cron) for the same fired
  switch create exactly one release — guarded on switch state (`triggered`) **and** an existing-release
  check for the current cycle. A second pass is a no-op.
- **No verified contacts**: The switch still triggers; the release has zero grants; no email is sent; a
  `released` event with grant count 0 is recorded.
- **Unverified contacts excluded**: Only contacts with `verified_at != null` are snapshotted; an
  unverified (possibly attacker-controlled) address never receives a grant.
- **View-once / replay**: A grant is consumed when `viewed_at` is set; re-opening the same link returns
  `410 Gone` with no content.
- **Expired grant**: `now >= expires_at` (inclusive) returns `410 Gone` and does not reveal the note.
- **Unknown / malformed token**: A missing, malformed, or non-matching token yields a generic
  not-available result disclosing nothing about release/grant/owner existence (no enumeration).
- **Decrypt failure on open**: Fails closed with `500`, returns no plaintext, and leaves `viewed_at`
  unset so the single view is not burned by a transient failure.
- **Per-grant email failure**: One contact's send failing marks that grant `failed` (non-sensitive
  error), does not abort the others, and does not block the trigger.
- **Rate limiting**: The public release route is rate-limited so a client cannot brute-force or scrape
  tokens; a normal single open is unaffected.
- **Test-release does not trigger**: A manual preview never changes switch state and is scoped to the
  caller's own verified contacts; a user can never address another user's contacts.
- **Token never logged**: No log line, event detail, or API response ever contains a raw grant token or
  note plaintext (only the SHA-256 hash and ciphertext are persisted).
- **Note edited/absent at release time**: The note is decrypted **on open** from the current ciphertext;
  if the owner has no note, the release still records but the open returns a generic not-available result
  (no plaintext, no leak).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On grace-expiry the engine MUST create exactly one `release` for the firing switch,
  snapshot the owner's **verified** contacts only (`verified_at != null`), mint one one-time grant token
  per snapshotted contact, and persist a `release_grant` per contact storing only the token's SHA-256
  hash and a future `expires_at`.
- **FR-002**: For each grant the engine MUST email the contact, via the generic `notify()` dispatcher
  (email channel — never a provider directly), a message explaining a note awaits them plus a single
  `APP_BASE_URL/r/<token>` link carrying the raw token exactly once; the raw token MUST NOT be stored,
  logged, or otherwise persisted.
- **FR-003**: The engine MUST record each grant's delivery outcome as `email_status`
  (`pending` → `sent` | `failed`), capture a `provider_message_id` when available and a non-sensitive
  `email_error` on failure, and MUST NOT abort the release because one grant's email failed.
- **FR-004**: On firing the engine MUST transition the switch to `triggered` and record a `triggered`
  event and a `released` event whose detail carries only non-sensitive metadata (e.g. a grant count) and
  never note plaintext or any token value.
- **FR-005**: Release creation MUST be **idempotent** and guarded on switch state **plus** an
  existing-release check: a switch already `triggered`, or one with a release already recorded for the
  current cycle, MUST NOT produce a second release or additional grants — so the in-process timer and an
  external cron can never double-release.
- **FR-006**: A switch whose owner has **no** verified contacts MUST still transition to `triggered`,
  record a release with zero grants, send no email, and record a `released` event (grant count 0).
- **FR-007**: The system MUST expose a **public** (no-auth) `GET /api/release/{token}` endpoint that
  hashes the supplied token, looks the grant up by hash, and uses no caller-supplied grant id, owner id,
  or session (authority is the token alone).
- **FR-008**: The public release endpoint MUST return the note **only** when the token hashes to a stored
  grant **and** `viewed_at` is null **and** `now < expires_at`; on success it MUST decrypt the owner's
  note server-side via the keyring, set `viewed_at` to now (single-use / view-once), and return the note
  text exactly once.
- **FR-009**: The public release endpoint MUST return `410 Gone` (no content) for an already-viewed or
  expired grant, and a generic not-available result for a missing/malformed/unknown token, disclosing
  nothing about whether any release, grant, or owner exists.
- **FR-010**: The public release endpoint MUST **fail closed**: if the owner's note cannot be decrypted
  (key version absent or auth tag fails) it MUST return `500` with no plaintext or partial content and
  MUST NOT set `viewed_at` (so the single view is not burned by a transient failure).
- **FR-011**: The public release endpoint MUST be **rate-limited** so excessive requests (token guessing
  / scraping) are throttled without impeding a normal single open.
- **FR-012**: The grant token MUST follow the existing hashed-token pattern (high-entropy random value
  shown once in the link, only its SHA-256 hash stored, looked up by hashing the incoming token); the raw
  token MUST never be compared from storage and MUST never appear in a log, an event, or a response.
- **FR-013**: The system MUST expose an authed `POST /api/deadman/test-release` that, scoped to
  `req.user.id`, creates a release tagged `manual_test`, mints a grant to the owner's **own verified
  contact address(es)**, emails the tokenized link via the generic dispatcher, and **does not** change
  the switch state — so a user can preview the recipient experience without triggering for real.
- **FR-014**: `POST /api/deadman/test-release` MUST reject unauthenticated callers with `401` and MUST
  reject (with a clear error, no email) a caller who has no verified contact to send to.
- **FR-015**: The OpenAPI contract (`contracts/openapi.yaml`) MUST be the source of truth for the new
  `GET /api/release/{token}` and `POST /api/deadman/test-release` paths and any new response schemas, the
  `DeadmanEvent` type enum MUST gain `released`, and `shared/src/api.ts` MUST be regenerated via
  `npm run gen:api`; the shared grant-token TTL MUST live in `shared/src/constants.ts` so client and
  server agree.
- **FR-016**: The client MUST provide a **public** `/r/:token` view-once page that prominently warns the
  note can be opened only once, renders the note text on a valid first open, shows a clear "no longer
  available" message for an expired/already-viewed link, and a generic error on failure — with semantic,
  keyboard-accessible markup (no colour-only signalling), reachable without a session and registered
  outside `ProtectedRoute` in `client/src/App.tsx`.
- **FR-017**: All release/grant handling MUST keep note plaintext out of every persisted artifact except
  the existing encrypted `note.ciphertext`: plaintext is materialized in memory only at the moment a
  valid grant link is opened and then discarded; it is never logged, never stored in a release/grant row,
  and never placed in an event detail.

### Key Entities *(include if feature involves data)*

- **Release (`release`)**: One record per firing (or per manual preview) of a user's switch. Carries the
  owning `user_id`, a `trigger` discriminator (`schedule` for a real fire, `manual_test` for a preview),
  and `created_at`. The existing-release check for the current cycle backs idempotency (FR-005).
- **Release grant (`release_grant`)**: One per recipient contact in a release; carries the one-time
  token's SHA-256 `token_hash` (UNIQUE; the raw token is never stored), the note-owner `user_id` (for
  decrypt), the snapshotted `contact_id`, an absolute `expires_at`, a nullable `viewed_at` (set on first
  open; view-once), and delivery bookkeeping (`email_status`, `provider_message_id`, `email_error`). The
  public open path reaches a grant only via the token hash, never via a caller-supplied id.
- **Grant token (transient)**: A high-entropy random value, surfaced exactly once inside the emailed
  `APP_BASE_URL/r/<token>` link. Only its SHA-256 hash and expiry are persisted (on the grant row). It is
  single-use (consumed when `viewed_at` is set) and time-limited.
- **Contact (verified) (`contact`)**: The per-user contact from feature 006 extended by feature 009;
  **only** rows with `verified_at != null` are snapshotted into a release. This feature consumes the
  verified flag but never sets it.
- **Note (`note`)**: The existing encrypted note (feature 004). Decrypted server-side via the keyring
  **only** at the moment a valid grant link is opened; its plaintext is never persisted outside the
  existing `note.ciphertext`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A switch that lapses past its grace deadline produces, in 100% of fires, exactly one
  release that snapshots only verified contacts, mints one grant per verified contact, emails each a
  tokenized `APP_BASE_URL/r/<token>` link via the generic dispatcher, and transitions the switch to
  `triggered` with `triggered` + `released` events recorded.
- **SC-002**: Re-running the engine (including the in-process timer and an external cron together)
  produces **0** additional releases or grants for an already-triggered cycle (idempotency proven by a
  second tick creating nothing).
- **SC-003**: 100% of unverified contacts are excluded from a release (they receive no grant and no
  email); only verified contacts ever get a one-time link.
- **SC-004**: Opening a valid grant link exactly once returns the decrypted note; a second open returns
  `410 Gone` with no content, and an expired link returns `410 Gone` (view-once proven by re-opening).
- **SC-005**: 100% of decrypt failures on open return `500` with no plaintext/partial content and leave
  `viewed_at` unset (the single view is not burned by a transient failure).
- **SC-006**: 100% of unknown/malformed/expired tokens return a generic not-available result that
  discloses nothing about release/grant/owner existence; the public route is rate-limited so excessive
  requests are throttled.
- **SC-007**: A test release creates a `manual_test` release + grant(s) to the owner's own verified
  address and delivers the identical view-once experience, while leaving the switch state **unchanged**
  in 100% of cases; an unauthenticated test-release is rejected with `401`.
- **SC-008**: The raw grant token and note plaintext appear in **0** log lines, **0** events, and **0**
  persisted release/grant rows across the test suite (only the SHA-256 hash and the existing ciphertext
  are persisted).
- **SC-009**: The `/r/:token` page renders the single-use warning + note on a valid open and a clear "no
  longer available" message otherwise, is keyboard-reachable and screen-reader-announceable (WCAG AA, no
  colour-only signalling), verified by component/e2e a11y assertions.

## Assumptions

- **Engine exists**: The liveness engine (`runDeadmanTick`, `evaluate`, the `triggered` transition,
  injected `Deps` with clock + notifier) from feature 008 already exists; this feature **extends** the
  trigger step (which today only sets state + records `triggered`) to create the release and send grants.
- **Verified contacts exist**: Contact verification (feature 009) provides `verified_at`; only verified
  contacts are snapshotted. This feature reads that flag and adds no verification logic.
- **Encryption keyring exists**: The versioned keyring + fail-closed note decryption (feature 004) are
  reused to decrypt the owner's note server-side on a valid open; this feature adds no new crypto.
- **Email dispatcher exists**: Release emails are sent through the generic `notify()` dispatcher + email
  channel (feature 005); this feature builds the release email body and adds no new provider.
- **`APP_BASE_URL` is available**: The optional `APP_BASE_URL` env var (feature 008) is read where
  `EMAIL_PROVIDER` is read and used to build the absolute `/r/<token>` link; its default is
  `http://localhost:5173`.
- **Hashed-token pattern is reused**: Grant token mint/hash/compare reuse the existing SHA-256
  hashed-token approach (`auth/tokens.ts`, feature 009's `contacts/verification-token.ts`) via a shared
  `deadman/tokens.ts` helper, so the raw token is shown once and only its hash is stored. The same helper
  is shared with feature 011's check-in tokens.
- **Test seams exist**: The `DEADMAN_TEST_MODE` fast-forward seam (`POST /api/test/deadman`) and the
  capturing email provider from features 008/009 are reused to drive a full e2e cycle (arm → miss →
  grace → trigger → open link once → gone) without waiting real time and without the in-process timer
  (`DEADMAN_TICK_DISABLED=1`).
- **No new external service**: This feature adds two endpoints, two tables, and a view-once page but no
  new env var or external service (it reuses `APP_BASE_URL`, the email channel, and the keyring).

## Dependencies

- The liveness engine and `Deps`/`runDeadmanTick` (feature 008), whose `triggered` transition this
  feature extends into a full release; the `deadman_event` audit log (extended with a `released` type).
- Contact verification (feature 009) for the `verified_at` flag used to snapshot verified contacts only.
- The versioned encryption keyring + fail-closed note decryption (feature 004) for server-side decrypt on
  a valid open.
- The notification dispatcher + email channel (feature 005) to send each grant's tokenized link.
- The `APP_BASE_URL` configuration (feature 008) to build the absolute `/r/<token>` link in the email.
- The OpenAPI contract (`contracts/openapi.yaml`) + generated `shared/src/api.ts`, and the shared
  grant-token TTL in `shared/src/constants.ts`, as the single typed contract across client and server.
- The `DEADMAN_TEST_MODE` fast-forward seam and the capturing email provider (features 008/009) for the
  full e2e release cycle.
