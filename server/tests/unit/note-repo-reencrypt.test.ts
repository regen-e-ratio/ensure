import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import { createKeyring } from "../../src/crypto/keyring";
import {
  upsertNote,
  getNote,
  reencryptAll,
  notesUsingVersion,
  NoteDecryptError,
} from "../../src/db/note-repo";

const k = (fill: number) => Buffer.alloc(32, fill).toString("base64");
const keyV1 = createKeyring(`1:${k(1)}`, "1");
const keyV1V2 = createKeyring(`1:${k(1)},2:${k(2)}`, "2"); // v1+v2, active v2
const keyV3 = createKeyring(`3:${k(3)}`, "3");

let db: Db;

function seedUser(id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, `${id}@example.com`, id, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
}

beforeEach(() => {
  db = openDb(":memory:");
});

describe("reencryptAll / notesUsingVersion (US3)", () => {
  it("migrates every non-active row to the active version, losslessly", () => {
    seedUser("u1");
    seedUser("u2");
    upsertNote(db, "u1", "note one", keyV1);
    upsertNote(db, "u2", "note two", keyV1);
    expect(notesUsingVersion(db, 1)).toBe(2);

    const result = reencryptAll(db, keyV1V2);

    expect(result.migrated).toBe(2);
    expect(result.perVersion).toEqual({ 2: 2 });
    expect(notesUsingVersion(db, 1)).toBe(0);
    expect(notesUsingVersion(db, 2)).toBe(2);
    // still decrypt to their original plaintext under the new keyring (SC-005/SC-006)
    expect(getNote(db, "u1", keyV1V2)?.text).toBe("note one");
    expect(getNote(db, "u2", keyV1V2)?.text).toBe("note two");
  });

  it("leaves created_at/updated_at unchanged (re-seal, not a content edit)", () => {
    seedUser("u1");
    upsertNote(db, "u1", "stable", keyV1, "2026-02-02T02:02:02.000Z");
    const before = db
      .prepare("SELECT created_at, updated_at FROM note WHERE user_id = ?")
      .get("u1");

    reencryptAll(db, keyV1V2);

    const after = db.prepare("SELECT created_at, updated_at FROM note WHERE user_id = ?").get("u1");
    expect(after).toEqual(before);
  });

  it("is a no-op when every note is already on the active version", () => {
    seedUser("u1");
    upsertNote(db, "u1", "already current", keyV1V2); // sealed under active v2
    const result = reencryptAll(db, keyV1V2);
    expect(result.migrated).toBe(0);
    expect(result.perVersion).toEqual({ 2: 1 });
  });

  it("fails loudly when a row's key version is unavailable (no silent skip, FR-015)", () => {
    seedUser("u3");
    upsertNote(db, "u3", "sealed under v3", keyV3); // key_version 3, absent from keyV1V2
    expect(() => reencryptAll(db, keyV1V2)).toThrow(NoteDecryptError);
    // transaction rolled back — the row is untouched and still readable under keyV3
    expect(getNote(db, "u3", keyV3)?.text).toBe("sealed under v3");
  });
});
