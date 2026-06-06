# Feature Specification: Per-User Note Ownership & Encryption at Rest

**Feature Branch**: `004-note-ownership-encryption`

**Created**: 2026-06-06

**Status**: Draft

**Input**: User description: "Let's work on the DB. The note needs to belong to an user. The user should only be allowed to read or update his own note. It is forbidden for a user to read or update another user's note. Also, the note should be encrypted in the DB. For the encryption, consider future secret rotations and how we handle them."

## Clarifications

### Session 2026-06-06

- Q: Note cardinality — one note per user, or multiple notes per user? → A: One note per user (singleton per owner, updated in place), extending the existing 001/002 single-note model.
- Q: Encryption secret scoping — single app-wide secret, per-user secret, or envelope encryption? → A: A single application-wide versioned secret; all notes are encrypted under the current version, and rotation introduces a new version applied to everyone.
- Q: How do existing notes migrate to a new secret after rotation — lazy, bulk, or both? → A: Both — a note is re-encrypted to the current secret the next time its owner saves (lazy), plus an explicit operator-run bulk re-encryption that forces completion so the old secret can be retired.

## User Scenarios & Testing *(mandatory)*

This feature evolves the foundation built in earlier work: the app already stores a note (001) and
already authenticates people via sign-in (002), but the note is still a single shared note with no
owner and is stored as readable text. This feature makes each note **belong to the person who wrote
it** — so people only ever see and change their own note, never anyone else's — and makes the stored
note **unreadable in the database** without the encryption secret, while planning ahead for the day
that secret must be **rotated** without losing access to existing notes. Sharing with contacts and
the deadman-switch acknowledgement remain future work.

### User Story 1 - My note is private to me (Priority: P1)

A signed-in person writes and saves a note. That note belongs to them. When they come back, they see
their own note and nothing else. Another signed-in person sees only their own note — never the first
person's content. Any attempt to read or change a note that belongs to someone else is refused.

**Why this priority**: Ownership and isolation are the core of this change and the prerequisite for
everything the product will become (a per-person deadman switch). Without it, notes leak across
people, which is unacceptable. This story alone delivers a usable, correct per-user note app.

**Independent Test**: Sign in as person A, save a note, sign out; sign in as person B and confirm B
sees an empty note (not A's), save a different note as B; sign back in as A and confirm A still sees
A's original note. Attempt to read/update B's note while acting as A and confirm it is refused.

**Acceptance Scenarios**:

1. **Given** person A has saved a note, **When** person A loads the app, **Then** A sees their own
   note text.
2. **Given** persons A and B have each saved a note, **When** person B loads the app, **Then** B
   sees B's note and never A's content.
3. **Given** person A is signed in, **When** an attempt is made to read or update a note owned by
   person B, **Then** the request is refused and none of B's note content is revealed.
4. **Given** a signed-in person who has never saved a note, **When** they load the app, **Then** they
   see their own empty state, not anyone else's note.
5. **Given** no one is signed in, **When** a read or update of a note is attempted, **Then** it is
   refused.

---

### User Story 2 - My note is unreadable in the database (Priority: P2)

The content a person saves is stored encrypted, so that someone with direct access to the database
(a backup file, a dump, a stolen disk) cannot read the note text without the encryption secret. The
owner still sees their original text exactly as written when they open the app.

**Why this priority**: Encryption at rest protects the most sensitive asset (the note content)
against database-level exposure. It builds on ownership (P1) and is independently demonstrable, but
ownership must exist first for "whose note is protected" to be meaningful.

**Independent Test**: Save a note through the app, then inspect the stored data directly and confirm
the note text does not appear in plaintext; reload the app as the owner and confirm the original text
is shown correctly.

**Acceptance Scenarios**:

1. **Given** a note has been saved, **When** the stored data is inspected directly, **Then** the note
   content is not present in readable plaintext.
2. **Given** an encrypted stored note, **When** its owner loads the app, **Then** the original text is
   decrypted and shown exactly as it was saved (lossless round-trip).
3. **Given** the encryption secret needed to decrypt a note is unavailable, **When** the owner tries
   to read it, **Then** the system refuses with a clear error and never serves the content as
   plaintext (fail closed).

---

### User Story 3 - The encryption secret can be rotated safely (Priority: P3)

Over time the encryption secret must be replaced (routine rotation, or in response to a suspected
compromise). The operator can introduce a new secret while every existing note stays readable, have
existing notes re-encrypted to the new secret, and then retire the old secret — all without losing
any note or exposing any note in plaintext.

**Why this priority**: Secret rotation is essential for long-term operability and incident response,
but it is an operational capability layered on top of working encryption (P2). The system must be
*designed* for rotation from the start even though rotation events are infrequent.

**Independent Test**: With notes encrypted under secret v1, introduce secret v2; confirm old notes
still read correctly and new saves use v2; run the re-encryption process; confirm every note is now
under v2; retire v1 and confirm all notes still read correctly.

**Acceptance Scenarios**:

1. **Given** notes encrypted under secret v1, **When** a new secret v2 is introduced as current,
   **Then** existing v1 notes remain readable and newly saved/updated notes use v2.
2. **Given** a mix of notes under v1 and v2, **When** any note is read, **Then** the system selects
   the correct secret version automatically and returns the right content.
3. **Given** the re-encryption process has run, **When** it completes, **Then** every note is
   protected by the current secret and none depends on v1.
4. **Given** at least one note still depends on v1, **When** removal of v1 is attempted, **Then** the
   removal is prevented to avoid making notes unreadable.
5. **Given** all notes have been re-encrypted, **When** v1 is retired and removed, **Then** all notes
   remain readable and no data is lost.

---

### Edge Cases

- **No note yet for a person**: A signed-in person who has never saved sees their own clearly empty
  state, isolated from every other person.
- **Cross-user access attempt**: A request to read or update a note that belongs to a different person
  is refused without revealing the other note's content or otherwise confirming details about it.
- **Concurrent updates by the same person**: If the same person edits in two places, the last saved
  update wins (in-place update of their single note), consistent with the existing single-note model.
- **Missing or invalid encryption secret at startup**: The system fails closed — it does not serve or
  accept notes it cannot protect/read, and surfaces a clear error rather than degrading to plaintext.
- **Retiring a secret still in use**: Removal of a secret that still protects one or more notes is
  prevented; the secret can only be removed after those notes are re-encrypted.
- **Very long note text**: The plaintext length limit (10,000 characters, from 001) is enforced on
  the text *before* encryption; over-limit input is rejected.
- **Pre-existing shared note**: The single shared, unowned note from before this feature is not
  carried forward to any person (see Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each note MUST be associated with exactly one owning person (its owner).
- **FR-002**: The system MUST scope every note read and update to the authenticated person's own note.
- **FR-003**: A person MUST be able to read only their own note; the system MUST NOT return another
  person's note content under any circumstance.
- **FR-004**: A person MUST be able to update only their own note; the system MUST reject any attempt
  to update a note owned by someone else.
- **FR-005**: An attempt to access a note that does not belong to the authenticated person MUST be
  refused without revealing that note's content or confirming details about it.
- **FR-006**: A signed-in person with no saved note MUST be shown a clear empty state specific to them.
- **FR-007**: Every note read and update MUST require an authenticated person; unauthenticated
  requests MUST be refused (builds on the existing authentication feature).
- **FR-008**: Note content MUST be stored encrypted at rest, such that direct inspection of the stored
  data does not reveal the plaintext.
- **FR-009**: The system MUST decrypt and present a note's original content to its owner without loss
  or alteration (lossless round-trip).
- **FR-010**: The system MUST record, for each stored note, which encryption secret/version protects
  it, so the correct secret can be selected when decrypting.
- **FR-011**: The system MUST support introducing a new encryption secret while continuing to read
  notes protected by previous secrets — with no data loss and no service interruption.
- **FR-012**: New and updated notes MUST be encrypted with the current (newest active) secret.
- **FR-012a**: When a note protected by a previous secret is updated by its owner, the system MUST
  re-encrypt it to the current secret as part of that save (lazy migration).
- **FR-013**: The system MUST also provide an explicit operator-run bulk re-encryption that migrates
  all notes still under a previous secret to the current secret, so migration can be forced to
  completion independently of owner activity.
- **FR-014**: The system MUST allow a previous secret to be removed only once no note depends on it,
  and MUST prevent removal of any secret that still protects at least one note.
- **FR-015**: The system MUST fail closed: if the secret required to read a note is unavailable, the
  system MUST NOT serve the note and MUST surface a clear error — it MUST NOT fall back to plaintext.
- **FR-016**: Encryption secrets MUST NOT be stored together with the encrypted note data, and MUST
  NOT be exposed to clients or written to logs.
- **FR-017**: The plaintext note length limit (10,000 characters) MUST be enforced on the content
  before it is encrypted.
- **FR-018**: The system MUST maintain a single current note per person (one note per owner), updated
  in place — the per-user evolution of the existing single-note model; prior versions are not kept.
- **FR-019**: The system MUST show when the person's own note was last updated.

### Key Entities *(include if feature involves data)*

- **Person (User)**: An authenticated individual, established by the existing authentication feature.
  Owns at most one note. Identity is the basis for all ownership and access decisions.
- **Note**: A single text entry owned by exactly one person. Key attributes: the encrypted content,
  a reference to its owner, the identifier/version of the encryption secret that protects it, and the
  time it was last updated. There is at most one note per owner, updated in place.
- **Encryption Secret (versioned)**: A single application-wide secret used to protect all note
  content at rest, identified by a version. All notes are encrypted under the current version;
  multiple versions may coexist during rotation, each with a status (current vs. retired). Secrets
  are managed outside the note data store and are never exposed to clients.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An authenticated person can read and update their own note successfully in 100% of
  attempts.
- **SC-002**: 0% of cross-user access attempts succeed — no person can ever read or modify another
  person's note (verified across owner/non-owner combinations).
- **SC-003**: Direct inspection of the stored note data reveals 0 occurrences of note content in
  plaintext.
- **SC-004**: Note content round-trips losslessly — decrypted content exactly equals what was saved —
  for 100% of notes.
- **SC-005**: After introducing a new secret, 100% of notes encrypted under previous secrets remain
  readable and correct.
- **SC-006**: After re-encryption completes, a previous secret can be fully retired with 0 notes left
  depending on it and 0 data loss.
- **SC-007**: When a required secret is unavailable, 0 notes are served in plaintext (fail-closed
  behavior is verified).

## Assumptions

- **Builds on authentication (002)**: This feature relies on the already-present authentication and
  user identity to determine the acting person. It is independent of feature 003, which is being
  developed in parallel and is not present in this branch.
- **One note per person**: Consistent with the single-note model from 001, each person has at most one
  note, updated in place — now scoped to its owner rather than shared.
- **No production data to migrate**: The product is pre-launch; there is no real note data to carry
  over. The previously single shared note is not assigned to any person under the new ownership model.
  (If real data existed, migrating/assigning it would be handled as a separate concern.)
- **Operator-managed, rotation-ready secrets**: Encryption secrets are supplied and managed by
  operators through secure server-side configuration (not stored in the note database, never sent to
  clients). Rotation is operator-initiated.
- **Rotation handling**: A single app-wide secret with multiple versions may coexist. On rotation,
  the new version becomes current for all new/updated notes; existing notes remain readable under
  their original version and are migrated forward two ways — lazily when their owner next saves, and
  via an explicit operator-run bulk re-encryption that forces completion — after which the old
  version can be retired. This keeps rotation non-disruptive and avoids any plaintext exposure.
- **Carried-over note rules**: The 10,000-character plaintext limit and plain-text treatment of note
  content (from 001) still apply.
- **Scope of encryption**: This feature protects note content at rest in the database. Transport
  security and broader infrastructure hardening are out of scope here.

## Out of Scope

- Sharing notes with contacts and the deadman-switch acknowledgement mechanism (future work).
- Multiple notes per person or note history/versioning.
- An access/audit log of who read or changed notes.
- Changes to how people sign in (provided by the existing authentication feature).
