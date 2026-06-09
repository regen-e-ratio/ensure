# Feature Specification: Email Stub Debug Logging

**Feature Branch**: `007-stub-debug-logging`

**Created**: 2026-06-08

**Status**: Draft

**Input**: User description: "Currently we don't have a email provider, we just have a stub and a UI to test the endpoints. I would like to have a debug log on the stub, to be sure the info I send on the front end reaches the backend correctly"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Confirm submitted Email fields reach the backend (Priority: P1)

As a developer testing the notifications feature locally, I open the test page, fill in the
Email fields (recipient, subject, body, body format), and submit. I then look at the server's
console output and see a debug log entry that shows the exact field values the backend
received, so I can confirm the front end sent what I expected and the backend parsed it
correctly — without needing a real email provider.

**Why this priority**: This is the entire purpose of the feature. Without it there is no way,
short of attaching a debugger, to verify that what the test page sends is what the backend
actually receives. It is independently valuable and the smallest shippable slice.

**Independent Test**: Enable the debug log, start the server, submit one Email from the test
page, and confirm a single log line appears containing the recipient, subject, body, and body
format that were entered.

**Acceptance Scenarios**:

1. **Given** the debug log is enabled and the stub provider is active, **When** a developer
   submits a valid Email from the test page, **Then** the server console shows one debug entry
   containing the recipient address, subject, body, and body-format that the backend received.
2. **Given** the debug log is enabled, **When** the submitted Email body format is HTML, **Then**
   the debug entry reflects the body as the backend holds it at the provider boundary (after
   server-side sanitization), so the developer can confirm what would actually be sent.
3. **Given** the debug log is enabled, **When** a send is submitted, **Then** the existing send
   outcome (sent/failed) shown on the test page is unchanged — the log is additive and does not
   alter behavior.

---

### User Story 2 - Keep the debug log off by default (Priority: P2)

As an operator (or any developer who is not actively debugging), I want the content-revealing
debug log to be off unless I explicitly turn it on, so that recipient addresses and message
content are never written to logs by default — preserving the privacy guarantee the
notification system already promises.

**Why this priority**: The notification system explicitly forbids writing recipient addresses or
message content to logs. A content-revealing debug log is a deliberate, local-debugging-only
exception and must not become the default behavior. This story protects against accidental
content leakage.

**Independent Test**: With the debug log NOT enabled, start the server, submit an Email, and
confirm that no recipient address or message content appears anywhere in the server logs.

**Acceptance Scenarios**:

1. **Given** the debug log is not enabled, **When** an Email is submitted, **Then** no recipient
   address, subject, or body appears in the server logs.
2. **Given** a fresh checkout with no debug configuration, **When** the server starts, **Then**
   the debug log is disabled (off by default).

---

### Edge Cases

- **Rejected before the provider**: When a submission fails validation (malformed recipient,
  empty subject/body, oversized content), the request never reaches the stub. The content debug
  log is not expected to fire in that case; verifying field arrival for invalid input is out of
  scope for this feature.
- **Empty optional values**: Body format is always one of the allowed choices; the log should
  still render clearly when a field is at its minimum valid value.
- **Large body**: A body near the maximum allowed size should still be logged without truncating
  in a way that hides whether the full content arrived (truncation, if any, must be explicit).
- **Debug log enabled in a shared/non-local environment**: Because the log reveals content, the
  feature must make the privacy trade-off explicit so it is not enabled outside local debugging.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The email stub provider MUST be able to emit a debug log entry, for each send it
  receives, that shows the message fields the backend received at the provider boundary
  (recipient, subject, body, and body format).
- **FR-002**: The debug log MUST be disabled by default and only active when a developer
  explicitly opts in (e.g., a documented configuration switch dedicated to this debug output).
- **FR-003**: When the debug log is disabled, the system MUST NOT write recipient addresses,
  subjects, or message bodies to any log, preserving the existing notification privacy guarantee.
- **FR-004**: The debug log MUST reflect the message as it stands at the provider boundary — i.e.
  after the backend's validation and, for HTML bodies, after server-side sanitization — so the
  developer sees what would actually be handed to a real provider.
- **FR-005**: The debug log MUST be additive: it MUST NOT change the send outcome, validation
  behavior, error handling, or anything the test page displays.
- **FR-006**: The debug output MUST be clearly identifiable as debug output and MUST make any
  truncation of large content explicit (the developer must be able to tell whether the full
  content arrived).
- **FR-007**: The feature MUST document, where the opt-in switch is described, that enabling the
  log writes recipient and message content to the server console and is intended for local
  debugging only.
- **FR-008**: The debug logging behavior MUST be limited to the stub provider; it MUST NOT
  introduce content logging into the shared channel/dispatch path that would also apply to a
  future real provider.

### Key Entities *(include if feature involves data)*

- **Email message (at provider boundary)**: The normalized message the stub receives — recipient
  address, subject, and exactly one of plain-text or sanitized-HTML body, plus the chosen body
  format. This is the data the debug log surfaces.
- **Debug-log opt-in switch**: A configuration flag that turns the content-revealing debug log on
  or off; off by default.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the debug log enabled, a developer can submit an Email from the test page and
  confirm, from the server console alone, that all four fields (recipient, subject, body, body
  format) arrived as entered — in under 1 minute and with no debugger or code change.
- **SC-002**: With the debug log disabled, 100% of submissions produce zero log lines containing
  the recipient, subject, or body.
- **SC-003**: Enabling or disabling the debug log changes no send outcome and no test-page output
  — every existing notification scenario behaves identically with the log on or off.
- **SC-004**: A developer new to the project can discover how to turn the debug log on, and learn
  that it reveals content and is local-only, from the project's setup documentation without
  reading source code.

## Assumptions

- The stub provider is the active email provider in local development (the only provider supported
  today), so logging at the stub is sufficient to verify front-end-to-backend field arrival.
- "Debug log" means human-readable output on the server console/standard logging output the
  developer is already watching when running the app locally; no new log store, file, or UI is
  required.
- Showing the message at the provider boundary (post-validation, post-sanitization) is what the
  developer wants, since that is the data a real provider would receive; this is preferred over
  logging the raw pre-validation request.
- The content-revealing debug log is an intentional, documented exception to the notification
  system's "never log recipient or content" rule, justified because the stub performs no real
  send and the switch is off by default and local-only.
- Verifying arrival of inputs that fail validation (and therefore never reach the stub) is out of
  scope; this feature covers requests that pass validation and reach the provider boundary.
