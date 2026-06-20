import Database from "better-sqlite3";

export type Db = Database.Database;

/**
 * Open a SQLite database at the given path (use ":memory:" for tests) and ensure
 * the schema exists. The `note` table is keyed by `user_id` (PRIMARY KEY), which
 * enforces one note per owner at the database level (FR-001, FR-018) and ties every
 * note to exactly one user; content is stored as `ciphertext` (BLOB) plus the
 * `key_version` that protects it — no plaintext column remains (FR-008, FR-010). The
 * `user` and `session` tables back Google SSO and the silent-refresh session model
 * (per data-model.md).
 */
export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS note (
      user_id     TEXT    PRIMARY KEY REFERENCES user(id),
      ciphertext  BLOB    NOT NULL,
      key_version INTEGER NOT NULL,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_note_key_version ON note(key_version);

    CREATE TABLE IF NOT EXISTS user (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL,
      name          TEXT,
      created_at    TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES user(id),
      token_hash   TEXT NOT NULL UNIQUE,
      expires_at   TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_token_hash ON session(token_hash);
    CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);

    CREATE TABLE IF NOT EXISTS contact (
      id          TEXT NOT NULL PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES user(id),
      type        TEXT NOT NULL,
      value       TEXT NOT NULL,
      value_norm  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      UNIQUE (user_id, type, value_norm)
    );

    CREATE INDEX IF NOT EXISTS idx_contact_user_id ON contact(user_id);

    CREATE TABLE IF NOT EXISTS deadman_config (
      user_id                  TEXT    PRIMARY KEY REFERENCES user(id),
      enabled                  INTEGER NOT NULL DEFAULT 0,
      state                    TEXT    NOT NULL DEFAULT 'disarmed',
      checkin_interval_seconds INTEGER NOT NULL,
      grace_period_seconds     INTEGER NOT NULL,
      last_checkin_at          TEXT,
      next_checkin_due_at      TEXT,
      grace_deadline_at        TEXT,
      reminders_sent           INTEGER NOT NULL DEFAULT 0,
      created_at               TEXT    NOT NULL,
      updated_at               TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_deadman_state_due
      ON deadman_config(state, next_checkin_due_at);

    CREATE TABLE IF NOT EXISTS deadman_event (
      id         TEXT NOT NULL PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES user(id),
      type       TEXT NOT NULL,
      detail     TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_deadman_event_user
      ON deadman_event(user_id, created_at);
  `);
  return db;
}
