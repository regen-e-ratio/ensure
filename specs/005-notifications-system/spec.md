# Feature Specification: Generic Notification System (Email)

**Feature Branch**: `005-notifications-system`

**Created**: 2026-06-07

**Status**: Draft

**Input**: User description: "In the future it will be necessary to send notifications to users. These notifications will be emails, whatsapp messages and push notifications. Maybe more types. We need to create a generic notifications system, that will be reused everytime the system needs to send any notification. Let's start simple and create a generic notification system where only emails are allowed. Also create a page in the UI that allows to test the notifications system easily and can be extended when we have more notification types."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Send a notification through the system (Priority: P1)

As a person operating the application, I open a dedicated test page, choose the Email channel,
enter a recipient address and the message content, and send it. The system delivers the message
through the email channel and shows me a clear outcome (delivered or failed, with a reason on
failure).

**Why this priority**: This is the smallest end-to-end slice that proves the generic notification
capability exists and works. Without it there is nothing to reuse and nothing to extend. It is the
MVP: a working, observable notification path through one channel.

**Independent Test**: Sign in, open the notifications test page, select Email, enter a valid
recipient and content, send, and confirm a success outcome is shown (and the email is received).
Repeat with an unreachable/invalid setup and confirm a failure outcome with a reason is shown.

**Acceptance Scenarios**:

1. **Given** an authenticated user on the test page with Email selected, **When** they enter a
   valid recipient address and non-empty content and submit, **Then** the system attempts delivery
   via the email channel and shows a success outcome.
2. **Given** an authenticated user on the test page with Email selected, **When** they submit with
   a malformed recipient address, **Then** the request is rejected with a validation message and no
   delivery is attempted.
3. **Given** the email delivery provider is unavailable, **When** a user submits a valid request,
   **Then** the system shows a failure outcome with a human-readable reason and remains usable.

---

### User Story 2 - Reuse the notification capability from anywhere in the system (Priority: P2)

As a developer building any feature, I can request that a notification be sent by calling one
generic, uniform capability — supplying the channel, the recipient, and the content — without
embedding channel-specific delivery logic in my feature.

**Why this priority**: The stated purpose is a *reusable* system "used every time the system needs
to send any notification." A one-off email sender would not satisfy this. It depends on P1 existing
but adds the reuse guarantee that makes the feature worth building generically.

**Independent Test**: From a second part of the system (or an automated test), invoke the generic
send capability with a channel + recipient + content and observe the same delivery and outcome
behavior as the test page, with no channel-specific code in the caller.

**Acceptance Scenarios**:

1. **Given** any caller in the system, **When** it requests a notification with channel = Email,
   recipient, and content, **Then** the notification is delivered (or fails with a reason) using the
   same path as the test page.
2. **Given** a caller that supplies an unsupported channel, **When** it requests a send, **Then**
   the system rejects the request with a clear "channel not supported" outcome rather than failing
   silently.

---

### User Story 3 - Ready to extend to new channels (Priority: P3)

As a maintainer, I can see that the system and its test page are structured so that new channel
types (WhatsApp, push, and others) can be added later. Today only Email is enabled; other channels
are visibly accounted for but cannot be used to send.

**Why this priority**: Extensibility is an explicit goal ("can be extended when we have more
notification types"), but it delivers no user-facing value on its own until a second channel is
actually added. It constrains the design rather than adding behavior now.

**Independent Test**: On the test page, confirm Email is selectable and sendable, and that the
extension point for future channels is visible (e.g., other channels listed as unavailable) without
allowing a send. Confirm that adding a hypothetical new channel would not require changes to
existing callers.

**Acceptance Scenarios**:

1. **Given** the test page, **When** a user views the available channels, **Then** Email is offered
   as usable and any not-yet-implemented channels are presented as unavailable (cannot be selected
   to send).
2. **Given** the selected channel is Email, **When** the user views the input fields, **Then** the
   fields shown are those Email requires (recipient address, subject, body), establishing the
   pattern for per-channel fields.

---

### Edge Cases

- **Malformed recipient**: a recipient address that is not a valid email is rejected before any
  delivery attempt.
- **Empty/whitespace content**: a request with empty required content (e.g., empty body) is rejected
  with a validation message.
- **Provider failure / timeout**: the email provider rejects the message or is unreachable — the
  system surfaces a failure outcome with a reason and does not crash or hang indefinitely.
- **Unsupported channel requested**: a request for a channel that is not yet enabled returns a clear
  "channel not supported" outcome.
- **Unauthenticated access**: an unauthenticated visitor cannot reach the test page or trigger a
  send; they are routed to sign-in (consistent with the rest of the app).
- **Oversized content**: content beyond a reasonable size limit is rejected with a clear message
  rather than being silently truncated or causing a provider error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a single, generic notification-sending capability that any part of
  the application can invoke to send a notification, independent of which channel delivers it.
- **FR-002**: The capability MUST accept, for each request, the target channel, the recipient, and
  the message content, and route the request to the matching channel.
- **FR-003**: System MUST support the **Email** channel for sending notifications.
- **FR-004**: System MUST be extensible so that additional channel types (e.g., WhatsApp, push) can
  be added later **without requiring changes to existing callers** of the generic capability.
- **FR-005**: For the Email channel, the system MUST require a recipient email address and message
  content (a subject and a body) and MUST validate the recipient address format before attempting
  delivery.
- **FR-006**: System MUST reject any request with missing or invalid required fields (empty
  recipient, empty content, malformed email, oversized content) and return a validation error
  **without attempting delivery**.
- **FR-007**: System MUST report an explicit outcome for every send attempt — success or failure —
  and, on failure, a human-readable reason. No request may fail silently.
- **FR-008**: System MUST handle delivery-provider errors (rejection, unavailability, timeout)
  gracefully: such errors MUST be surfaced as a failed outcome and MUST NOT crash the application.
- **FR-009**: System MUST reject a request that targets a channel which is not currently enabled,
  with a clear "channel not supported" outcome.
- **FR-010**: System MUST provide a UI **test page** where an authenticated user can select a
  channel, enter the required fields for that channel, trigger a send, and see the resulting outcome.
- **FR-011**: The test page MUST present the available channel(s) as usable and present
  not-yet-enabled channels in a way that makes the extension point visible while preventing sending
  through them.
- **FR-012**: The test page MUST adapt its input fields to the selected channel (for Email:
  recipient address, subject, body).
- **FR-013**: The test page and the send capability MUST be accessible only to authenticated users,
  consistent with the rest of the application's sign-in model.
- **FR-014**: System MUST keep delivery-provider credentials/secrets server-side only — never
  exposing them to the client and never writing recipient addresses or message content to logs in a
  way that exposes sensitive data.
- **FR-015**: The test page MUST meet the accessibility baseline: semantic markup, labelled
  controls, full keyboard navigation, and WCAG AA contrast.

### Key Entities *(include if feature involves data)*

- **Notification Request**: a single request to deliver one message to one recipient through one
  channel. Key attributes: channel type, recipient, content (for Email: subject and body).
- **Channel**: a delivery mechanism with a type (Email enabled now; WhatsApp, push planned) and an
  availability state (enabled / not yet enabled). Each channel defines which fields a request needs.
- **Send Outcome**: the result of a send attempt — success, or failure with a human-readable reason
  (e.g., validation error, unsupported channel, provider error).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An authenticated user can send a test email from the test page and see a clear
  success-or-failure outcome within 5 seconds of submitting.
- **SC-002**: A new caller elsewhere in the system can send a notification using only the generic
  capability — supplying channel, recipient, and content — with no channel-specific delivery code in
  the caller.
- **SC-003**: Adding a new channel type requires changes only inside the notification system and its
  test page — zero modifications to existing callers of the generic capability.
- **SC-004**: 100% of send attempts return an explicit outcome (success or a specific failure
  reason); none fail silently.
- **SC-005**: 100% of invalid requests (malformed email, empty content, oversized content,
  unsupported channel) are rejected before any delivery attempt.
- **SC-006**: The test page is fully operable by keyboard alone and meets WCAG AA contrast.

## Assumptions

- Email is delivered through an **external email provider** configured via server-side settings;
  selecting and provisioning that provider is a setup concern handled at implementation time, not
  fixed by this spec.
- "Delivered successfully" means the message was **accepted by the delivery provider**, not a
  read- or delivery-receipt confirmation from the recipient's mailbox.
- The test page **reuses the existing Google sign-in**; any authenticated user may access it (the
  application has no separate admin/role system today).
- **v1 scope is single notification, single recipient per request** — no batch/bulk sending, no
  message templating, no scheduling, and no retry/queue guarantees beyond reporting the immediate
  outcome.
- **v1 does not include a persistent, browsable history or audit log** of sent notifications; the
  test page shows the immediate outcome only. (Consistent with the project's "keep it simple"
  principle.)
- **WhatsApp and push channels are out of scope for implementation in v1** but the system and test
  page are designed to accommodate them.
- The existing application's authentication, monorepo structure, and data store are reused; this
  feature adds the notification capability and test page on top of them.
