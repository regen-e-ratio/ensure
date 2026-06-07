# Feature Specification: User Settings Page — Manage Contacts

**Feature Branch**: `006-user-settings-contacts`

**Created**: 2026-06-07

**Status**: Draft

**Input**: User description: "We need a user settings page. For now only one thing will be there for read and update: a list of contacts. Create the user settings page where the user can add and remove contacts. In the future a contact can be different things, like phone numbers or usernames. For now only emails will be allowed. Keep in mind the DB data structure needs to consider having multiple types of contacts."

## Clarifications

### Session 2026-06-07

- Q: Should adding an email contact include any ownership/verification step (e.g. confirmation email), or just record the address? → A: Record only — no verification step in this release.
- Q: Is there a maximum number of contacts a single user may store? → A: Soft cap of 50 contacts per user.
- Q: What maximum length should an email value allow? → A: 320 characters.
- Q: How should an email value be stored, given duplicate detection is case-insensitive? → A: Preserve the original case as entered (trimmed); duplicate detection compares a separate case-insensitive normalized form.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View my contacts in settings (Priority: P1)

A signed-in user opens their settings page and sees the list of contacts they have
saved. If they have none yet, they see a clear empty state inviting them to add one.

**Why this priority**: Reading the current list is the foundation of the page — every
other action (add, remove) builds on the user being able to see what they have. It is
the smallest slice that delivers value on its own (a user can confirm what contacts are
on file) and is independently demonstrable.

**Independent Test**: Sign in as a user with zero, one, and several saved contacts, open
settings, and confirm the page renders each case correctly (empty state vs. populated
list) showing only that user's contacts.

**Acceptance Scenarios**:

1. **Given** a signed-in user with no saved contacts, **When** they open the settings
   page, **Then** they see an empty state indicating no contacts yet and a way to add one.
2. **Given** a signed-in user with one or more saved email contacts, **When** they open
   the settings page, **Then** each saved contact is listed with its email value.
3. **Given** a visitor who is not signed in, **When** they attempt to open the settings
   page, **Then** they are not shown any contacts and are directed to sign in.

---

### User Story 2 - Add an email contact (Priority: P1)

A signed-in user adds a new email address to their contact list from the settings page
and immediately sees it appear in the list.

**Why this priority**: Adding contacts is the primary write action and the core purpose
of the page. Combined with viewing (US1), it forms the minimum useful product: a user
can build up their list. Email is the only contact type allowed in this release.

**Independent Test**: From the settings page, enter a valid email, submit, and confirm it
is saved and shown in the list; reload the page and confirm it persists.

**Acceptance Scenarios**:

1. **Given** a signed-in user on the settings page, **When** they enter a well-formed
   email and submit, **Then** the contact is saved and appears in their list.
2. **Given** a signed-in user, **When** they submit an entry that is not a well-formed
   email, **Then** the contact is rejected with a clear validation message and nothing is
   saved.
3. **Given** a signed-in user whose list already contains a given email, **When** they
   add that same email again (ignoring case and surrounding whitespace), **Then** the
   system does not create a duplicate and informs the user it already exists, and the
   originally stored value (with its original case) is retained.
4. **Given** a signed-in user who already has 50 contacts, **When** they try to add another,
   **Then** the add is rejected with a clear message and the list is unchanged.
5. **Given** a contact was added, **When** the user reloads the settings page, **Then**
   the contact is still present.

---

### User Story 3 - Remove a contact (Priority: P2)

A signed-in user removes a contact from their list on the settings page and sees it
disappear.

**Why this priority**: Removal completes basic list management but is less critical than
viewing and adding for an initial release — a user gets value from the page before
removal exists. It is still required for the list to be fully maintainable.

**Independent Test**: With at least one saved contact, remove it from the settings page
and confirm it disappears from the list and stays gone after reload.

**Acceptance Scenarios**:

1. **Given** a signed-in user with at least one contact, **When** they remove a contact,
   **Then** it is deleted from their list and no longer shown.
2. **Given** a contact was removed, **When** the user reloads the settings page, **Then**
   the removed contact does not reappear.
3. **Given** a signed-in user, **When** they remove a contact that another action already
   deleted, **Then** the system reports the list state without error and the contact
   remains absent.

---

### Edge Cases

- **Not signed in**: All read and write actions require authentication; an unauthenticated
  request is rejected and reveals no contact data.
- **Malformed email**: Entries that are not valid email addresses (missing `@`, empty,
  whitespace-only, obviously malformed) are rejected with a clear message.
- **Duplicate email**: The same email (compared case-insensitively and trimmed of
  surrounding whitespace) cannot appear twice in one user's list.
- **Cross-user isolation**: A user can only ever see and modify their own contacts; one
  user's contacts are never exposed to or affected by another user.
- **Future contact types**: Although only email is accepted now, the stored data records
  each contact's type so that phone numbers, usernames, or other types can be added later
  without restructuring existing data. Any attempt to save a non-email type in this
  release is rejected.
- **Empty list after removal**: Removing the last contact returns the user to the empty
  state, not an error.
- **Very long input**: Entries longer than 320 characters are rejected with a clear message
  rather than being stored.
- **List full**: Attempting to add a contact when the user already has 50 is rejected with a
  clear message; the existing list is unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a user settings page accessible only to
  authenticated users.
- **FR-002**: The settings page MUST display the list of contacts belonging to the
  currently signed-in user, and MUST show a clear empty state when the user has none.
- **FR-003**: The system MUST scope all contact reads and writes to the authenticated
  user, so that a user can never view or modify another user's contacts.
- **FR-004**: Users MUST be able to add a contact to their list from the settings page.
- **FR-005**: Users MUST be able to remove a contact from their list from the settings
  page.
- **FR-006**: In this release, the system MUST accept only contacts of type **email** and
  MUST reject any other contact type.
- **FR-007**: The system MUST validate that an email contact is a well-formed email
  address before saving, and MUST reject invalid values with a clear message.
- **FR-008**: The system MUST prevent duplicate contacts within a single user's list,
  treating email values as equivalent when they differ only by letter case or surrounding
  whitespace.
- **FR-009**: The system MUST persist contacts so they remain available across sessions
  and page reloads.
- **FR-010**: The system MUST store each contact together with its **type** so that the
  data structure supports multiple contact types (e.g. phone number, username) in the
  future without altering or migrating existing contacts.
- **FR-011**: The system MUST associate every contact with exactly one owning user.
- **FR-012**: The system MUST reject all contact read and write requests from
  unauthenticated callers without disclosing any contact data.
- **FR-013**: The system MUST store an email value with its original letter case preserved
  (after trimming surrounding whitespace), while duplicate detection (FR-008) MUST compare a
  separate case-insensitive normalized form so display casing and uniqueness are both predictable.
- **FR-014**: The system MUST reject any contact value longer than 320 characters with a
  clear message, and MUST NOT store it.
- **FR-015**: The system MUST limit each user to at most 50 contacts and MUST reject an add
  that would exceed this limit with a clear message.
- **FR-016**: After a successful add or remove, the settings page MUST reflect the updated
  list to the user.

### Key Entities *(include if feature involves data)*

- **User**: An authenticated account (the existing user established by the authentication
  feature). Owns zero or more contacts. Identified by the existing user identifier.
- **Contact**: A single way to reach or identify a user, owned by exactly one user. Key
  attributes: the owning user, a **type** (currently only `email`, but the attribute
  exists so future types such as `phone` or `username` can be added), the **value** (the
  email address as entered, trimmed, with original case preserved for display), a
  case-insensitive **normalized form** of the value used only for duplicate detection, and
  creation metadata. Uniqueness is enforced per user across (type, normalized value). A user
  may hold at most 50 contacts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in user can add a valid email contact and see it in their list in
  under 5 seconds, including the time to confirm it was saved.
- **SC-002**: A signed-in user can remove a contact and see it gone in under 5 seconds.
- **SC-003**: 100% of contacts added by a user are visible only to that user and never to
  any other user.
- **SC-004**: 100% of invalid email submissions are rejected with a clear message and do
  not create a stored contact.
- **SC-005**: Duplicate email entries (differing only by case or surrounding whitespace)
  never result in more than one stored contact in a user's list.
- **SC-006**: Contacts added by a user remain present after the user signs out and signs
  back in, with no loss.
- **SC-007**: Adding a second contact type in a future release requires no change to
  contacts already stored under the email type (verified by the stored data carrying an
  explicit type per contact).
- **SC-008**: A user can store up to 50 contacts; the 51st add attempt is always rejected
  with a clear message and never stored.
- **SC-009**: An email saved with mixed case (e.g. `Alice@Example.com`) is displayed back
  with that exact case, while a later add of `alice@example.com` is still detected as a
  duplicate.

## Assumptions

- **Authentication exists**: The application already has an authentication/session model
  (Google SSO from feature 002) that identifies the current user; this feature reuses it
  rather than introducing new auth.
- **Per-user privacy**: Contacts are private to the owning user, consistent with the
  per-user ownership model established for notes (feature 004). There is no sharing or
  cross-user visibility in this release.
- **Add/remove only**: "Read and update" for the list is satisfied by viewing, adding, and
  removing contacts. In-place editing of an existing contact's value is out of scope;
  changing a contact is achieved by removing and re-adding.
- **No verification step**: Adding an email simply records it. Sending a confirmation
  email, verifying ownership of the address, or any messaging to the contact is out of
  scope for this release.
- **Single settings section**: The settings page contains only the contacts list for now;
  it is structured so additional settings sections can be added later, but none are
  included in this release.
- **No bulk operations**: Importing, exporting, or bulk-editing contacts is out of scope.
- **Email is the only permitted type now**: The type attribute is stored to enable future
  types, but the system actively rejects any type other than email in this release.
- **Reasonable list size**: A user may hold at most 50 contacts (FR-015); no pagination is
  required for this release.

## Dependencies

- The existing authentication and session model (feature 002) to identify the current
  user and protect the settings page and contact endpoints.
- The existing per-user data store, extended with a new structure for contacts that
  records an explicit contact type per entry.
