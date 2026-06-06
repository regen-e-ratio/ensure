import type { components } from "@ensure/shared/api";
import type { Db } from "./index";

export type User = components["schemas"]["User"];

/** Identity fields from a verified Google ID token. */
export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name };
}

/**
 * Insert the user on first sign-in (keyed by Google `sub`) or update their
 * email/name and `last_login_at` on subsequent sign-ins. Returns the stored user.
 */
export function upsertUser(
  db: Db,
  profile: GoogleProfile,
  now: string = new Date().toISOString(),
): User {
  db.prepare(
    `INSERT INTO user (id, email, name, created_at, last_login_at)
     VALUES (@id, @email, @name, @now, @now)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       last_login_at = excluded.last_login_at`,
  ).run({ id: profile.sub, email: profile.email, name: profile.name, now });
  return getUser(db, profile.sub) as User;
}

/** Return the user with the given id (Google `sub`), or null when none exists. */
export function getUser(db: Db, id: string): User | null {
  const row = db.prepare("SELECT id, email, name FROM user WHERE id = ?").get(id) as
    | UserRow
    | undefined;
  return row ? toUser(row) : null;
}
