# Feature Specification: Google SSO Authentication & Access Protection

**Feature Branch**: `002-google-sso-auth`

**Created**: 2026-06-05

**Status**: Draft

**Input**: User description: "I want for the app to have SSO. For now the only allowed SSO login is google. Protect the endpoints, only users with the access token are able to call them. Add a page in the UI for login and protect the other pages to not allow unauthorized access"

## Clarifications

### Session 2026-06-05

- Q: Who is allowed to sign in (any Google account, an email allowlist, or a Workspace domain)? → A: Any valid Google account is permitted in this version.
- Q: How long should an access token / session stay valid before re-authentication? → A: ~1 hour.
- Q: When a session is still active but the access token expires, what should happen? → A: Silently refresh the token while the user is active; only require re-login after a period of inactivity.
- Q: How long of inactivity before the user must sign in with Google again? → A: ~24 hours.
- Q: Should the system record authentication events (sign-in successes/failures) for security/observability? → A: No auth event logging in this version.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in with Google (Priority: P1)

A visitor opens the app and is presented with a dedicated login page. They choose to sign in
with Google, complete Google's sign-in flow, and are returned to the app as an authenticated
user. From that point on they can view and edit the shared note.

**Why this priority**: Without the ability to sign in, no protected functionality is reachable.
This is the foundational journey that every other capability depends on, and on its own it
delivers a usable, secured application.

**Independent Test**: Can be fully tested by visiting the login page, completing the Google
sign-in flow with a valid Google account, and confirming the user lands in the app in an
authenticated state. Delivers the core value of gated access.

**Acceptance Scenarios**:

1. **Given** an unauthenticated visitor on the login page, **When** they choose "Sign in with
   Google" and successfully authenticate with a valid Google account, **Then** they are returned
   to the app as an authenticated user and can access the note.
2. **Given** an unauthenticated visitor, **When** they begin the Google sign-in flow but cancel
   or fail to authenticate, **Then** they remain on the login page, are not granted access, and
   see a clear message that sign-in did not complete.
3. **Given** an already-authenticated user, **When** they navigate to the login page, **Then**
   they are recognized as signed in and are not forced to authenticate again.

---

### User Story 2 - Protected pages block unauthorized access (Priority: P1)

An unauthenticated visitor tries to open an application page other than the login page (for
example, by typing the note's URL directly). Instead of seeing protected content, they are
redirected to the login page. After signing in, they reach the page they were trying to view.

**Why this priority**: The purpose of adding SSO is to prevent unauthorized access. A login page
that can be bypassed by navigating directly to a protected page provides no real protection, so
this is equally critical to User Story 1.

**Independent Test**: Can be tested by attempting to open a protected page while signed out and
confirming a redirect to the login page, then signing in and confirming access is granted.

**Acceptance Scenarios**:

1. **Given** an unauthenticated visitor, **When** they attempt to open any protected page
   directly, **Then** they are redirected to the login page and the protected content is never
   shown.
2. **Given** an unauthenticated visitor who was redirected to the login page from a protected
   page, **When** they complete sign-in, **Then** they are taken to the page they originally
   requested.
3. **Given** an authenticated user, **When** they navigate between protected pages, **Then** they
   are not interrupted by repeated sign-in prompts.

---

### User Story 3 - Protected endpoints require a valid access token (Priority: P1)

Every request to a protected backend operation must carry a valid access token issued through the
sign-in flow. Requests without a token, or with an invalid or expired token, are rejected; only
authenticated requests can read or modify the note.

**Why this priority**: UI-only protection is insufficient — the data is exposed if the underlying
operations can be called directly without a token. Securing the endpoints is essential to the
feature's intent and must ship together with the UI protection.

**Independent Test**: Can be tested by calling a protected operation with no token, with an
invalid/expired token, and with a valid token, and confirming only the valid-token request
succeeds.

**Acceptance Scenarios**:

1. **Given** a protected operation, **When** it is called with no access token, **Then** the
   request is rejected as unauthorized and no data is read or changed.
2. **Given** a protected operation, **When** it is called with an invalid or expired access
   token, **Then** the request is rejected as unauthorized.
3. **Given** a protected operation, **When** it is called with a valid access token, **Then** the
   request is processed normally.

---

### User Story 4 - Sign out (Priority: P2)

An authenticated user chooses to sign out. Their session ends, and any subsequent attempt to
access protected pages or operations requires signing in again.

**Why this priority**: Sign-out is important for shared or public devices and for completing the
authentication lifecycle, but the app is usable and secure without it, so it ranks below the
core sign-in and protection stories.

**Independent Test**: Can be tested by signing in, signing out, and confirming protected pages
and operations are no longer accessible without signing in again.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they sign out, **Then** their session ends and they
   are returned to the login page.
2. **Given** a user who has just signed out, **When** they attempt to access a protected page or
   operation, **Then** access is denied until they sign in again.

---

### Edge Cases

- **Expired access token while still active**: When a user's access token expires but the user is
  still active, the system silently obtains a fresh token and the in-progress action continues
  without interruption.
- **Expired session after inactivity**: When the session has lapsed after ~24 hours of inactivity
  (no silent refresh available), the next protected action fails as unauthorized and the user is
  guided back to sign in, rather than seeing a broken or silently failing page.
- **Sign-in cancelled or denied**: If the user cancels the Google flow or Google denies the
  request, the app shows a clear, non-technical message and keeps them on the login page.
- **Non-Google sign-in attempt**: Since Google is the only allowed provider, no other sign-in
  option is offered; any attempt to use a different provider is not possible from the UI.
- **Direct deep-link while signed out**: Visiting a protected URL directly while signed out
  redirects to login and preserves the intended destination for after sign-in.
- **Token tampering**: A modified or forged token is treated as invalid and rejected.
- **Concurrent edits by different signed-in users**: Multiple authenticated users editing the
  single shared note follow the existing note's save/conflict behavior; SSO does not change that
  behavior beyond requiring authentication.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a dedicated login page where unauthenticated users can
  initiate sign-in.
- **FR-002**: The system MUST offer "Sign in with Google" as the only sign-in method; no other
  identity provider is offered or accepted in this version.
- **FR-003**: The system MUST authenticate a user against Google and, on success, establish an
  authenticated session for that user in the app.
- **FR-004**: The system MUST issue an access token to the authenticated user that is required for
  all subsequent protected operations.
- **FR-005**: The system MUST reject any request to a protected operation that lacks a valid
  access token, returning an unauthorized result without performing the operation.
- **FR-006**: The system MUST reject requests bearing an invalid, tampered, or expired access
  token as unauthorized.
- **FR-007**: The system MUST allow requests bearing a valid access token to proceed to the
  requested protected operation.
- **FR-008**: The system MUST restrict every application page except the login page (and any
  public assets required to render it) to authenticated users only.
- **FR-009**: The system MUST redirect unauthenticated users who attempt to reach a protected
  page to the login page, and MUST NOT render protected content to them.
- **FR-010**: The system MUST return a user who signed in after being redirected to the page they
  originally requested.
- **FR-011**: The system MUST recognize an already-authenticated user and not require them to
  sign in again while their session is valid.
- **FR-012**: The system MUST allow an authenticated user to sign out, ending their session and
  invalidating their access for protected pages and operations.
- **FR-013**: The system MUST show clear, non-technical feedback when sign-in does not complete
  (cancelled, denied, or failed) and keep the user on the login page.
- **FR-014**: The system MUST guide a user whose session has lapsed (after ~24 hours of inactivity,
  with no silent refresh possible) back to sign-in rather than failing silently.
- **FR-016**: An access token MUST remain valid for approximately 1 hour, after which it is no
  longer accepted for protected operations.
- **FR-017**: While a user remains active, the system MUST silently renew (refresh) the access
  token as it nears expiry so the user is not interrupted; re-authentication is required only
  after ~24 hours of inactivity during which no refresh occurs.
- **FR-015**: The login page and all authentication interactions MUST meet the project's
  accessibility baseline (semantic markup, full keyboard operability, and WCAG AA contrast).

### Key Entities *(include if feature involves data)*

- **Authenticated User**: A person who has successfully signed in with Google. Identified by the
  identity Google provides (e.g., a stable account identifier and email); the app records enough
  to recognize the user across requests for the duration of their session. No password is stored.
- **Session / Access Token**: The credential that proves a request comes from an authenticated
  user. Valid for approximately 1 hour, after which it is no longer accepted; renewed silently
  while the user is active, and can be ended early by signing out.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests to protected operations made without a valid access token are
  rejected and result in no data being read or modified.
- **SC-002**: 100% of attempts to open a protected page while unauthenticated result in a redirect
  to the login page with no protected content exposed.
- **SC-003**: A first-time user can complete sign-in with Google and reach the note in under 30
  seconds (excluding time spent on Google's own consent screens).
- **SC-004**: A returning user with a valid session reaches protected content without re-entering
  credentials in at least 95% of visits.
- **SC-007**: An active user is never forced to re-authenticate solely because their ~1-hour
  access token expired; the token is silently refreshed while they remain active.
- **SC-008**: After ~24 hours of continuous inactivity, the next attempt to use a protected page
  or operation requires signing in with Google again, in 100% of cases.
- **SC-005**: Google is the only sign-in option presented, and no alternative provider can be used
  to gain access.
- **SC-006**: After signing out, a user can no longer access any protected page or operation until
  they sign in again, in 100% of attempts.

## Assumptions

- **Any valid Google account is permitted** in this version (confirmed): authentication succeeds
  for any user who can sign in with Google. Restricting access to a specific allowlist or Google
  Workspace domain is out of scope for v1 and can be added later.
- **User accounts are provisioned automatically on first sign-in**; there is no separate
  registration step and no admin approval flow.
- **The single shared note remains shared across all authenticated users** — SSO adds an access
  gate but does not introduce per-user private notes or role-based permissions.
- **Access tokens expire after ~1 hour** (confirmed) and are silently refreshed while the user is
  active, so the exact value is fixed at the spec level rather than deferred to planning.
- **The existing note view/edit/save behavior is unchanged** apart from now requiring
  authentication to reach it.
- **Sign-in requires connectivity to Google's identity service**; if Google is unavailable, users
  cannot sign in, and the app surfaces a clear message.
- **No multi-factor or account-recovery flows are owned by this app** — those are handled entirely
  by Google as the identity provider.
- **No authentication event logging or audit trail is in scope for v1** (confirmed): the app is
  not required to record sign-in successes, failures, sign-outs, or rejected requests. Auditing
  can be added later if a security need arises.
