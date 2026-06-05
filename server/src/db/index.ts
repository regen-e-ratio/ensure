import Database from "better-sqlite3";

export type Db = Database.Database;

/**
 * Open a SQLite database at the given path (use ":memory:" for tests) and ensure
 * the singleton `note` table exists. The CHECK (id = 1) constraint guarantees at
 * most one note row at the database level (per data-model.md).
 */
export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS note (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      text       TEXT    NOT NULL,
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );
  `);
  return db;
}
