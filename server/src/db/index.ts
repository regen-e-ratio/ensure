import Database from "better-sqlite3";

export type Db = Database.Database;

/**
 * Open a SQLite database at the given path (use ":memory:" for tests) and ensure
 * the schema exists. The singleton `note` table's CHECK (id = 1) constraint
 * guarantees at most one note row at the database level. The `user` and `session`
 * tables back Google SSO and the silent-refresh session model (per data-model.md).
 */
export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS note (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      text       TEXT    NOT NULL,
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

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
  `);
  return db;
}
