# Feature Specification: Store a Note

**Feature Branch**: `001-store-notes`

**Created**: 2026-06-03

**Status**: Draft

**Input**: User description: "The long term goal is to create a deadman switch app. Where when the user doesn't acknowledge that is is alive, some notes are shared with the given contacts. Let's start with the basics. Let's Build an web app that gives the possiblity for the user to store notes, a text input. the notes should be persisted in a DB in the backend. Out of scope for now: accounts, authentication"

## Clarifications

### Session 2026-06-05

- Q: How should the notes list behave as the number of saved notes grows? → A: There is no list of notes — the app holds a single note that the user can update in place.
- Q: How should the note get saved when the person edits it? → A: Explicit Save button, plus a warning if the person tries to leave with unsaved changes.

## User Scenarios & Testing *(mandatory)*

This is the foundational slice of a future "deadman switch" application. For now the goal is
deliberately small: let a person write and keep a single text note in a web app, durably persisted
so it survives page reloads, browser restarts, and server restarts, and editable so the person can
revise it over time. Sharing the note with contacts and the deadman-switch acknowledgement
mechanism are explicitly future work and out of scope here.

### User Story 1 - Write and save my note (Priority: P1)

A person opens the web app, types text into a note input, and saves it. The text is stored durably
as their note so it is not lost when they close or reload the page.

**Why this priority**: Writing and durably storing the note is the irreducible core of the product.
Without it there is nothing to revise or later share. This story alone is a usable MVP.

**Independent Test**: Open the app with no note yet, type text, save, then reload the page (and
restart the server) and confirm the saved text is still present. Delivers the core value of durable
note capture.

**Acceptance Scenarios**:

1. **Given** no note has been saved yet, **When** the person types text and saves, **Then** the
   text is persisted as the note and a confirmation that it was saved is shown.
2. **Given** a note has been saved, **When** the page is reloaded, **Then** the saved text is shown
   in the note input.
3. **Given** a note has been saved, **When** the backend is restarted, **Then** the saved text is
   still retrievable (it is persisted in durable storage, not only in memory).
4. **Given** an empty or whitespace-only input, **When** the person attempts to save, **Then** the
   note is not saved and the person is informed that note text is required.

---

### User Story 2 - Review and revise my note (Priority: P2)

A person returns to the app, sees the text they previously saved, edits it, and saves again. The
new text replaces the old text as the single stored note.

**Why this priority**: A single editable note is only useful if its current content can be read
back and changed. This story makes the stored note visible and revisable, but it depends on Story 1
existing first.

**Independent Test**: With a note already saved, load the app and confirm the current text is shown;
change it, save, reload, and confirm the updated text is shown (and the previous text is gone).

**Acceptance Scenarios**:

1. **Given** a note has been saved, **When** the person opens the app, **Then** the current note
   text is shown in the input along with when it was last updated.
2. **Given** the current note is shown, **When** the person changes the text and presses Save,
   **Then** the new text replaces the previous text as the single stored note.
3. **Given** no note has been saved yet, **When** the person opens the app, **Then** an empty input
   and a clear empty state are shown inviting them to write their note.
4. **Given** the person has edited the text but not saved, **When** they attempt to leave or reload
   the page, **Then** they are warned about unsaved changes before the edits are discarded.

---

### Edge Cases

- **Empty / whitespace-only input**: Saving is rejected with a clear message; the stored note is
  left unchanged (or remains absent if none was saved yet).
- **Very long note text**: Text up to a defined maximum length (see FR-008) is accepted; input
  beyond the maximum is rejected with a clear message rather than silently truncated.
- **Special characters / formatting**: Text containing punctuation, emoji, line breaks, or
  characters that resemble markup is stored and displayed exactly as entered, without being
  interpreted as executable content.
- **Unsaved changes on exit**: If the person has edited the text without saving and tries to leave
  or reload the page, they are warned so the edits are not silently lost.
- **Backend unavailable**: If a save or load cannot reach the backend, the person sees a clear
  error and the app does not falsely report success.
- **Concurrent sessions**: Because there are no accounts and there is a single shared note, two
  sessions saving the note resolve last-write-wins; a session sees the other's text after it
  loads/reloads.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a text input through which a person can enter or edit the content
  of the note, pre-filled with the currently stored note text (or empty if no note exists yet).
- **FR-002**: System MUST allow a person to save the entered text as the note via an explicit Save
  action; edits are persisted only when that action is invoked.
- **FR-002a**: System MUST warn the person when they attempt to leave or reload the page with
  unsaved edits, giving them a chance to stay and save before the edits are discarded.
- **FR-003**: System MUST persist the saved note in durable backend storage so it survives page
  reloads and backend restarts.
- **FR-004**: System MUST reject attempts to save an empty or whitespace-only note and inform the
  person that note text is required, leaving any previously stored note unchanged.
- **FR-005**: On load, System MUST display the currently stored note text, or a clear empty state
  when no note has been saved yet.
- **FR-006**: Saving when a note already exists MUST replace the stored text in place; the system
  keeps a single current note and does not retain prior versions or a list of separate notes.
- **FR-007**: System MUST show when the note was last updated.
- **FR-008**: System MUST accept note text up to a maximum length of 10,000 characters and reject
  longer input with a clear message.
- **FR-009**: System MUST store and display note text exactly as entered, treating it as plain text
  so that any markup-like characters are not interpreted as executable content.
- **FR-010**: System MUST inform the person with a clear error when a save or load operation fails,
  and MUST NOT report success for an operation that did not complete.
- **FR-011**: System MUST treat the note as a single shared note, with no per-user separation,
  since accounts and authentication are out of scope; concurrent saves resolve last-write-wins.

### Key Entities *(include if feature involves data)*

- **Note**: The single text entry maintained by the app. Key attributes: the note's text content
  and the time it was last updated (and, optionally, when it was first created). There is exactly
  one note in this version — it is updated in place rather than added to a collection — and it is
  not associated with any individual account.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can write and save the note in under 30 seconds from opening the app.
- **SC-002**: 100% of successfully saved note text remains retrievable after a page reload and after
  a backend restart.
- **SC-003**: After saving, the updated note text is shown as the current note within 2 seconds.
- **SC-004**: Attempts to save empty or whitespace-only text are rejected 100% of the time with a
  visible explanation.
- **SC-005**: A first-time visitor can identify how to write the note and successfully save it on
  their first attempt without external guidance.

## Assumptions

- **Single note**: The app maintains exactly one note (a singleton), not a list. Saving updates that
  one note in place. This matches the clarified intent and keeps the foundation minimal; multiple
  notes can be revisited later if needed.
- **No version history**: Saving overwrites the previous text; prior versions are not retained.
- **Single shared note**: With accounts and authentication out of scope, there is no per-user
  separation; every visitor sees and edits the same note. Concurrent saves are last-write-wins.
  This is acceptable for this early foundation and will be revisited when accounts are introduced.
- **Plain text only**: The note is plain text; rich text, attachments, and file uploads are out of
  scope.
- **Maximum note length**: 10,000 characters is assumed sufficient and bounds storage and display;
  this can be adjusted later.
- **Connectivity**: The app is used online with the backend reachable; offline use and local-only
  drafts are out of scope.
- **Future scope (not in this feature)**: Designated contacts, the liveness/acknowledgement
  ("deadman switch") mechanism, and sharing the note with contacts are explicitly deferred to later
  features and are not specified here.
