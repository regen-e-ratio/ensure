# Phase 1 Data Model: Store a Note

**Feature**: `001-store-notes` | **Date**: 2026-06-05

## Entity: Note (singleton)

The application maintains exactly **one** note. It is updated in place rather than added to a
collection (per the clarified single-note model). There is no per-user separation in this version.

### Fields

| Field | Type | Required | Description | Source requirement |
|-------|------|----------|-------------|--------------------|
| `id` | integer | yes | Primary key. Always `1` — enforces the singleton (exactly one row). | FR-006 |
| `text` | string | yes | The note content, plain text. 1–10,000 characters after trimming check. | FR-001, FR-002, FR-004, FR-008, FR-009 |
| `created_at` | string (ISO 8601 UTC) | yes | When the note was first created. Set on first save, never changed afterward. | Key Entities |
| `updated_at` | string (ISO 8601 UTC) | yes | When the note was last saved. Updated on every successful save. | FR-007 |

### Validation rules

- **Non-empty** (FR-004): `text` must contain at least one non-whitespace character. Trimming is used
  only for the emptiness check; the stored value preserves the user's exact input including leading/
  trailing whitespace and line breaks (FR-009).
- **Maximum length** (FR-008): `text` length must be ≤ `NOTE_MAX_LENGTH` (10,000 characters).
  Over-length input is rejected with a clear error — never silently truncated.
- **Plain text** (FR-009): stored and returned verbatim; never interpreted as markup. The client
  renders it as text content (e.g., textarea value), not HTML.

Validation constant `NOTE_MAX_LENGTH = 10000` lives in `shared/src/constants.ts` so client and server
enforce the same limit.

### Lifecycle / state transitions

```text
(no note)  --- first successful save (PUT) --->  (note exists)
(note exists) --- subsequent save (PUT) --->  (note exists, text + updated_at replaced)
```

- There is no delete and no version history in this version (overwrite-in-place, FR-006).
- "No note yet" is represented by the absence of the row (table empty), surfaced to the client as a
  `null` note so it can show the empty state (FR-005).

### Persistence

- SQLite table created on startup if absent:

  ```sql
  CREATE TABLE IF NOT EXISTS note (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    text       TEXT    NOT NULL,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
  );
  ```

- The `CHECK (id = 1)` constraint guarantees at most one note row at the database level.
- `upsertNote(text)`: `INSERT INTO note (id, text, created_at, updated_at) VALUES (1, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at;`
  (so `created_at` is preserved across updates; `updated_at` advances each save).
- Concurrent saves resolve **last-write-wins** (FR-011) — the most recent `PUT` wins; no locking
  beyond SQLite's own transaction handling.

## Relationships

None. A single standalone entity. (Future features — contacts, liveness checks — will introduce
related entities, explicitly out of scope here.)
