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
  // Make concurrent writers (the in-process liveness timer and an external `deadman:tick` cron run
  // on separate connections) wait for a lock instead of immediately throwing SQLITE_BUSY, so a
  // release transaction is not silently dropped mid-flight under contention.
  db.pragma("busy_timeout = 5000");
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
  `);

  db.exec(`
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

  // Feature 010 — release & secure one-time delivery (roadmap §3). A `release` groups the grants
  // created for one fired (or test) cycle; each `release_grant` carries a one-time token (stored
  // ONLY as its SHA-256 hash), a future `expires_at`, a view-once `viewed_at`, and per-grant email
  // delivery status. The note owner's `user_id` is denormalized onto the grant so the PUBLIC open
  // route can decrypt the owner's note without a session. The index backs the public lookup by hash.
  db.exec(`
    CREATE TABLE IF NOT EXISTS release (
      id         TEXT NOT NULL PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES user(id),
      trigger    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS release_grant (
      id                  TEXT NOT NULL PRIMARY KEY,
      release_id          TEXT NOT NULL REFERENCES release(id),
      user_id             TEXT NOT NULL REFERENCES user(id),
      contact_id          TEXT NOT NULL REFERENCES contact(id),
      token_hash          TEXT NOT NULL UNIQUE,
      expires_at          TEXT NOT NULL,
      viewed_at           TEXT,
      email_status        TEXT NOT NULL DEFAULT 'pending',
      provider_message_id TEXT,
      email_error         TEXT,
      created_at          TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_release_grant_token
      ON release_grant(token_hash);

    -- Durable idempotency for the engine fire (FR-005, SC-002): at most one 'schedule' release per
    -- user, ever. This makes the never-double-release guarantee atomic across processes -- when the
    -- in-process timer and an external deadman:tick cron evaluate the same grace switch at once,
    -- only one INSERT can win; the loser's INSERT fails the unique constraint and the engine treats
    -- it as already-released (no second release, grants, or duplicate recipient emails). Manual
    -- test-releases (trigger='manual_test') are intentionally unconstrained so previews can repeat.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_release_one_schedule_per_user
      ON release(user_id) WHERE trigger = 'schedule';
  `);

  // Feature 011 — passwordless email check-in links (roadmap §3). Each grace reminder mints a
  // fresh one-time check-in token and persists ONLY its SHA-256 hash here (never the raw token),
  // with the owning `user_id` (so the PUBLIC check-in route derives the user without a session),
  // a future `expires_at`, and a nullable `used_at` (set on the first successful check-in;
  // single-use). The index backs the public look-up by hash.
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkin_token (
      id         TEXT NOT NULL PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES user(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at    TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_checkin_token_hash
      ON checkin_token(token_hash);
  `);
  return db;
}
