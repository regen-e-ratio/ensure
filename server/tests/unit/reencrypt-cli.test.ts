import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import { createKeyring } from "../../src/crypto/keyring";
import { upsertNote, NoteDecryptError } from "../../src/db/note-repo";
import { runReencrypt, formatSummary } from "../../src/cli/reencrypt-notes";

const k = (fill: number) => Buffer.alloc(32, fill).toString("base64");
const keyV1 = createKeyring(`1:${k(1)}`, "1");
const keyV1V2 = createKeyring(`1:${k(1)},2:${k(2)}`, "2");
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

describe("reencrypt CLI core (US3)", () => {
  it("formatSummary prints migrated count and per-version remaining", () => {
    expect(formatSummary({ migrated: 3, perVersion: { 2: 5 } })).toBe(
      'migrated=3 remaining_by_version={"2":5}',
    );
  });

  it("runReencrypt migrates non-active rows and reports the result", () => {
    seedUser("u1");
    seedUser("u2");
    upsertNote(db, "u1", "one", keyV1);
    upsertNote(db, "u2", "two", keyV1);

    expect(runReencrypt(db, keyV1V2)).toBe('migrated=2 remaining_by_version={"2":2}');
  });

  it("throws on an undecryptable row so the CLI exits non-zero (FR-015)", () => {
    seedUser("u3");
    upsertNote(db, "u3", "sealed under v3", keyV3);
    expect(() => runReencrypt(db, keyV1V2)).toThrow(NoteDecryptError);
  });
});
