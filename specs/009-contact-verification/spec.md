# Feature Specification: Contact Verification

**Feature Branch**: `009-contact-verification`

**Created**: 2026-06-20

**Status**: Draft

**Input**: User description: "A contact must prove control of its address before it can ever receive a
release. Add verification state to a contact (`verified_at`, `verification_token_hash`,
`verification_expires_at`), treating any pre-existing contact (null `verified_at`) as unverified. The
owner triggers a verification email via the generic notify() dispatcher (an `APP_BASE_URL` link
carrying a one-time, hashed, expiring token); resending refreshes the token. A public, no-auth
endpoint validates the token by hash, enforces expiry and single-use, sets `verified_at`, and renders
a result. The contact list shows a verified/unverified badge per contact and a 'Send
verification'/'Resend' action with accessible status messaging; a public verification-result page
shows success/failure. This is a prerequisite for release (feature 010): only verified contacts ever
receive a one-time release link."

## Clarifications

### Session 2026-06-20

- Q: What is the verification token's lifetime, and is it single-use? → A: Short-lived (24 hours from
  mint) and single-use — `verification_expires_at` bounds it and `verified_at` being set burns it.
  Resending mints a fresh token, overwrites the stored hash, and resets the expiry; any prior link is
  thereby invalidated.
- Q: How are pre-existing contacts (created before this feature) treated? → A: As **unverified**. The
  three new columns are added nullable; a null `verified_at` means unverified, so every existing row is
  unverified by default with no backfill or migration of state.
- Q: Where is the token stored and how is it compared? → A: The raw token appears **only once**, inside
  the emailed `APP_BASE_URL` link; the database stores only its SHA-256 hash
  (`verification_token_hash`). Verification hashes the incoming token and compares against the stored
  hash (mirroring the session/refresh-token pattern in `auth/`), and never logs the plaintext token.
- Q: Is the public verify endpoint authenticated? → A: No. `GET /api/contact/verify?token=…` is public
  (no session) because the recipient is a contact, not necessarily an Ensure user. Authority comes
  entirely from possession of the unguessable token; no contact id or owner is taken from the caller.
- Q: Can a contact be re-verified (idempotency)? → A: Yes. Sending verification to an already-verified
  contact is allowed (re-confirm); opening a valid link for an already-verified contact returns success
  (`already verified`) without error and does not change `verified_at`. An expired or already-consumed
  link returns a clear failure result.
- Q: Does the serialized Contact expose verification state? → A: Yes. The OpenAPI `Contact` schema gains
  a `verified` boolean (derived: `verified_at != null`) and a nullable `verifiedAt` timestamp, so the
  client can render the badge. The token hash and expiry are internal and are never serialized.

## User Scenarios & Testing *(mandatory)*

<!--
  User stories are prioritised, independently testable journeys. US1 alone is a viable slice: an owner
  can send a verification email and the recipient can confirm via the link, flipping the contact to
  verified — the prerequisite that feature 010 depends on. US2 surfaces verification state + the action
  in the UI. US3 hardens the token lifecycle (expiry / single-use / invalid). US4 covers idempotent
  re-verification and the unverified-by-default treatment of pre-existing contacts.
-->

### User Story 1 - Send a verification email and confirm a contact (Priority: P1)

A signed-in owner picks one of their contacts and sends it a verification email. The contact receives
an email containing a single link. Opening that link confirms control of the address: the contact
becomes **verified**, and a result page tells the recipient the address is confirmed.

**Why this priority**: This is the core round-trip and the prerequisite for any release (feature 010):
only verified contacts ever receive a note. The smallest slice that delivers value is "owner sends →
recipient clicks → contact verified".

**Independent Test**: As a signed-in owner with one contact, call the send endpoint and assert a
verification email is dispatched through the generic notifier (spy) to the contact's address with a
link containing a token under `APP_BASE_URL`; then call the public verify endpoint with that token and
assert the contact's `verified_at` is set, the serialized contact reports `verified: true`, and the
result indicates success.

**Acceptance Scenarios**:

1. **Given** a signed-in owner with an unverified contact, **When** they request verification for that
   contact, **Then** a verification email is sent via the generic `notify()` dispatcher to the contact's
   address, a one-time hashed token with a future expiry is stored against the contact, and the response
   indicates the email was sent.
2. **Given** a verification email whose link carries a valid, unexpired, unused token, **When** the
   recipient opens the link (no sign-in), **Then** the contact's `verified_at` is set to now, the token
   is consumed, and a success result is returned/rendered.
3. **Given** a contact that has just been verified, **When** the owner lists their contacts, **Then**
   that contact is serialized with `verified: true` and a non-null `verifiedAt`.
4. **Given** a visitor who is not signed in, **When** they call the **send** endpoint
   (`POST /api/contact/{id}/verify`), **Then** the request is rejected with `401` and no email is sent.
5. **Given** a signed-in owner, **When** they request verification for an `id` that is not their own
   contact, **Then** the request is rejected (treated as not-found) and no email is sent — one user can
   never address another user's contact.

---

### User Story 2 - See verification state and (re)send verification (Priority: P1)

An owner views their contact list and can tell at a glance which contacts are verified and which are
not, and can send (or resend) a verification email per contact, with clear, accessible status feedback.

**Why this priority**: Verification is only useful if the owner can see and act on it. This makes the
US1 capability operable from the UI and is required before an owner can sensibly arm a switch that
relies on verified contacts.

**Independent Test**: Render the contact list with a mix of verified and unverified contacts; assert a
distinct accessible badge per state; click "Send verification" on an unverified contact and assert the
send client call fires and a polite status message ("Verification email sent.") is announced; assert a
verified contact shows a "Resend" affordance and the verified badge.

**Acceptance Scenarios**:

1. **Given** the owner's contact list contains both verified and unverified contacts, **When** it
   renders, **Then** each contact shows a clearly labelled verified or unverified badge (not by colour
   alone).
2. **Given** an unverified contact in the list, **When** the owner activates its "Send verification"
   control, **Then** the send request is issued and a polite, non-blocking status message confirms the
   email was sent (or an assertive error is shown on failure).
3. **Given** an already-verified contact, **When** the list renders, **Then** the action is presented as
   "Resend" (re-confirmation is allowed) and the verified badge is shown.
4. **Given** the recipient lands on the public verification-result page after opening a link, **When**
   the page renders, **Then** it states clearly whether the address was confirmed or the link was
   invalid/expired/used, using semantic, keyboard-accessible markup with no reliance on colour alone.

---

### User Story 3 - Token lifecycle: expired, used, and invalid links (Priority: P1)

A verification link is short-lived and single-use. Opening an expired, already-used, or malformed/
unknown link does **not** verify the contact and returns a clear failure result.

**Why this priority**: A verification that could be replayed, forged, or never expired would let an
unverified (possibly attacker-controlled) address be marked verified and later receive a release. The
token guarantees are the security core of this feature and must be independently provable.

**Independent Test**: Mint a token, then (a) advance time past `verification_expires_at` and open the
link → failure, contact stays unverified; (b) open a valid link twice → first succeeds, second returns
"already used/invalid" without re-setting `verified_at`; (c) open with a random/garbage token → failure
with no information leak about whether any contact exists.

**Acceptance Scenarios**:

1. **Given** a verification token whose `verification_expires_at` is now in the past, **When** the link
   is opened, **Then** the contact is **not** verified and an "expired link" failure result is returned.
2. **Given** a verification token that has already been consumed (the contact's stored hash no longer
   matches, e.g. after success or a resend), **When** the old link is opened again, **Then** the request
   fails with an "invalid or already-used link" result and `verified_at` is unchanged.
3. **Given** an absent or malformed `token` query parameter, or a token that hashes to no stored
   contact, **When** the verify endpoint is called, **Then** it fails with a generic invalid-link result
   that does not disclose whether any particular contact or owner exists.
4. **Given** any verification flow, **When** logs and responses are inspected, **Then** the raw token
   value never appears in a log line, an event, or a serialized contact (only its hash is stored).

---

### User Story 4 - Idempotent re-verification & unverified-by-default (Priority: P2)

Re-confirming an already-verified contact is safe and non-destructive, and every contact that predates
this feature is treated as unverified until it completes the round-trip.

**Why this priority**: This guarantees a clean, predictable rollout (no false "verified" state for old
rows) and protects against confusing double-verification behaviour, but the core security/round-trip
(US1–US3) delivers the value first.

**Independent Test**: For a pre-existing contact row (null `verified_at`), assert it serializes as
`verified: false`. Verify it once (success), then open a fresh valid link again → success with
`already verified` and `verified_at` unchanged from the first verification. Resending verification to a
verified contact is accepted and mints a new token without clearing `verified_at`.

**Acceptance Scenarios**:

1. **Given** a contact created before this feature (no verification columns populated), **When** it is
   read, **Then** it serializes as `verified: false` with a null `verifiedAt` (unverified by default).
2. **Given** an already-verified contact, **When** a fresh valid verification link for it is opened,
   **Then** the result is success ("already verified") and `verified_at` retains its original value
   (idempotent — never moved backward or cleared).
3. **Given** an already-verified contact, **When** the owner resends verification, **Then** the send is
   accepted, a new token hash + expiry are stored, and `verified_at` is left unchanged.

---

### Edge Cases

- **Send for another user's contact**: `POST /api/contact/{id}/verify` is scoped to `req.user.id`; an
  `id` not owned by the caller is treated as not-found (`404`), and no email is sent — one user can
  never trigger verification of, or probe, another user's contact.
- **Unauthenticated send**: The send endpoint requires auth; an unauthenticated request is rejected with
  `401` and dispatches no email.
- **Public verify needs no session**: `GET /api/contact/verify?token=…` is intentionally public;
  authority is the unguessable token only. No contact id, owner id, or session is read from the caller.
- **Expired link**: When `now >= verification_expires_at` (inclusive), the link fails and the contact
  stays unverified.
- **Single-use / replay**: A successful verification (or a subsequent resend) replaces or consumes the
  stored hash, so re-opening the old link fails — the token cannot be replayed.
- **Unknown / malformed token**: A missing, malformed, or non-matching token yields a generic
  invalid-link failure that reveals nothing about contact existence (no user/contact enumeration).
- **Resend invalidates the prior link**: Resending mints a new token and overwrites the stored hash and
  expiry, so only the most recent link is valid.
- **Verify an already-verified contact**: Opening a valid current link for a verified contact returns
  success without changing `verified_at` (idempotent).
- **Removed contact mid-flight**: If a contact is deleted after a link is sent, opening the (now
  orphaned) link fails with the generic invalid-link result.
- **Email send failure**: If the verification email fails to dispatch, the owner gets a clear error and
  the contact remains unverified; the failure leaks no token and can be retried by resending.
- **Token never logged**: No log line, event detail, or API response ever contains the raw token (only
  the SHA-256 hash is persisted).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST extend a contact with verification state — a nullable `verified_at`
  timestamp, a nullable `verification_token_hash`, and a nullable `verification_expires_at` timestamp —
  added so that every pre-existing contact has a null `verified_at` and is therefore unverified.
- **FR-002**: A contact MUST be considered **verified** if and only if its `verified_at` is non-null;
  the serialized contact MUST expose a derived `verified` boolean and a nullable `verifiedAt`, and MUST
  NOT expose the token hash or expiry.
- **FR-003**: The system MUST let an authenticated owner request verification for one of **their own**
  contacts via `POST /api/contact/{id}/verify`, minting a high-entropy token, storing only its SHA-256
  hash and a future `verification_expires_at` against that contact, and sending a verification email.
- **FR-004**: The verification email MUST be sent through the generic `notify()` dispatcher (email
  channel), to the contact's address, and MUST contain a single link built from `APP_BASE_URL` that
  carries the raw token exactly once; the raw token MUST NOT be stored, logged, or otherwise persisted.
- **FR-005**: Requesting verification MUST be allowed as a resend/refresh: each request mints a fresh
  token, overwrites the stored `verification_token_hash`, and resets `verification_expires_at`, thereby
  invalidating any previously issued link for that contact.
- **FR-006**: The send endpoint MUST scope the contact by `req.user.id`; a contact id that is not the
  caller's own MUST be treated as not-found (`404`) with no email sent, so one user can neither verify
  nor probe another user's contacts.
- **FR-007**: The send endpoint MUST reject unauthenticated callers with `401` and dispatch no email.
- **FR-008**: The system MUST expose a **public** (no-auth) `GET /api/contact/verify?token=…` endpoint
  that hashes the supplied token, looks up the contact by that hash, and uses no caller-supplied contact
  id or session.
- **FR-009**: The public verify endpoint MUST succeed only when the token hashes to a stored
  `verification_token_hash` **and** `now < verification_expires_at`; on success it MUST set `verified_at`
  to now (single-use), and return/render a success result.
- **FR-010**: The public verify endpoint MUST fail closed for an expired token, a non-matching/consumed
  token, or a missing/malformed token, returning a generic invalid-or-expired-link result that does NOT
  disclose whether any contact or owner exists, and MUST leave `verified_at` unchanged.
- **FR-011**: Verification MUST be idempotent: opening a valid current link for an already-verified
  contact MUST return success ("already verified") and MUST NOT change the existing `verified_at`;
  resending to a verified contact MUST be accepted and MUST NOT clear `verified_at`.
- **FR-012**: The token comparison MUST follow the existing hashed-token pattern (store SHA-256 hash,
  hash the incoming token, look up by hash); the raw token MUST never be compared from storage and MUST
  never appear in a log, an event, or a response.
- **FR-013**: The OpenAPI contract (`contracts/openapi.yaml`) MUST be the source of truth for the new
  endpoints and the extended `Contact` schema (`verified`, `verifiedAt`), and `shared/src/api.ts` MUST
  be regenerated from it (`npm run gen:api`); the shared verification-token TTL MUST live in
  `shared/src/constants.ts` so client and server agree.
- **FR-014**: The contact list UI MUST show, per contact, a clearly labelled verified/unverified badge
  (not by colour alone) and a "Send verification" (unverified) / "Resend" (verified) control with
  accessible status messaging — a polite `role="status"` confirmation and an assertive `role="alert"`
  error — mirroring the existing `ContactList` patterns.
- **FR-015**: The client MUST provide a **public** verification-result page (e.g. route
  `/contact-verified`) that renders the success or invalid/expired/used outcome with semantic,
  keyboard-accessible markup, reachable without a session, and registered in `client/src/App.tsx`.
- **FR-016**: A verification email send failure MUST surface a clear error to the owner, MUST leave the
  contact unverified, and MUST NOT leak the token; the owner MUST be able to retry by resending.

### Key Entities *(include if feature involves data)*

- **Contact (extended) (`contact`)**: The existing per-user contact row (feature 006), now carrying
  verification state: a nullable `verified_at` (the moment control was proven; null = unverified), a
  nullable `verification_token_hash` (SHA-256 of the most recently issued token; the raw token is never
  stored), and a nullable `verification_expires_at` (absolute ISO-8601 expiry of the current token).
  Still scoped to its owning `user_id`; the public verify path reaches a contact only via the token
  hash, never via a caller-supplied id.
- **Verification token (transient)**: A high-entropy random value, surfaced exactly once inside the
  emailed `APP_BASE_URL` link. Only its SHA-256 hash and expiry are persisted (on the contact row). It
  is single-use (consumed when `verified_at` is set) and superseded by any resend.
- **User**: The existing authenticated account (feature 002). Owns the contacts and is the only caller
  permitted to trigger verification for them; the public verify endpoint involves no user session.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can send a verification email and the recipient can confirm the contact via the
  emailed link such that the contact flips to `verified: true` in 100% of valid round-trips, with the
  email dispatched only through the generic `notify()` dispatcher.
- **SC-002**: 100% of expired, already-used, and unknown/malformed tokens fail to verify a contact (the
  contact stays unverified) and return a generic result that discloses no contact/owner existence.
- **SC-003**: Opening a valid link exactly once verifies the contact; a second open of the same link
  never re-verifies or changes `verified_at` (single-use proven by re-opening).
- **SC-004**: 100% of pre-existing contacts (rows without verification columns populated) serialize as
  `verified: false`; no contact is ever reported verified without a completed round-trip.
- **SC-005**: Re-confirming an already-verified contact (valid link or resend) never moves or clears its
  `verified_at` (idempotency verified by comparing before/after timestamps).
- **SC-006**: The raw verification token appears in 0 log lines, 0 events, and 0 API/serialization
  outputs across the test suite (only the SHA-256 hash is persisted).
- **SC-007**: 100% of `POST /api/contact/{id}/verify` calls for a non-owned `id` are rejected as
  not-found with no email sent, and 100% of unauthenticated sends are rejected with `401`.
- **SC-008**: The contact list renders a distinct, text-labelled verified/unverified badge per contact
  and the verification-result page is keyboard-reachable and screen-reader-announceable (WCAG AA,
  no colour-only signalling), verified by component/e2e a11y assertions.

## Assumptions

- **Contacts exist**: The per-user contact model (feature 006) — table, repo, list/add/remove routes,
  and the `ContactList` UI — already exists; this feature extends it rather than introducing contacts.
- **Authentication exists**: The Google SSO session model (feature 002) and `requireAuth` gate the
  **send** endpoint via `req.user.id`; this feature adds no new auth. The **verify** endpoint is
  deliberately public (token-authority only).
- **Email dispatcher exists**: Verification emails are sent through the generic `notify()` dispatcher +
  email channel (feature 005); this feature calls it for the contact's address and adds no new provider.
- **`APP_BASE_URL` is available**: The optional `APP_BASE_URL` env var (introduced with feature 008) is
  read where `EMAIL_PROVIDER` is read and used to build the absolute verification link; its default is
  `http://localhost:5173`.
- **Hashed-token pattern is reused**: Token mint/hash/compare reuse the existing SHA-256 hashed-token
  approach in `auth/` (session/refresh tokens), so the raw token is shown once and only its hash is
  stored.
- **Prerequisite for release**: Feature 010 (release & one-time delivery) consumes the verified flag —
  only verified contacts ever receive a one-time release link. This feature provides that flag and the
  round-trip but performs no release itself.
- **Unverified by default**: The three columns are added nullable with no backfill; a null `verified_at`
  means unverified, so no existing contact is silently treated as verified.

## Dependencies

- The existing per-user contact store and repo (feature 006), extended in place with the three
  verification columns and an updated serialization.
- The existing authentication/session model (feature 002) and `requireAuth` middleware to gate and scope
  the send endpoint by `req.user.id`.
- The existing notification dispatcher and email channel (feature 005) to send the verification email to
  the contact's address.
- The `APP_BASE_URL` configuration (feature 008) to build the absolute verification link placed in the
  email.
- The OpenAPI contract (`contracts/openapi.yaml`) + generated `shared/src/api.ts`, and the shared
  verification-token TTL in `shared/src/constants.ts`, as the single typed contract across client and
  server.
