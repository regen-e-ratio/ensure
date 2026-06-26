import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import {
  addContact,
  countContacts,
  findByNormalized,
  listContacts,
  normalizeValue,
  removeContact,
} from "../../src/db/contact-repo";

let db: Db;

function seedUser(id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, `${id}@example.com`, null, "2026-06-07T00:00:00.000Z", "2026-06-07T00:00:00.000Z");
}

beforeEach(() => {
  db = openDb(":memory:");
  seedUser("u1");
  seedUser("u2");
});

describe("contact-repo — listContacts (US1)", () => {
  it("returns only the given user's contacts, ordered by created_at", () => {
    addContact(db, "u1", "email", "a@example.com", "2026-06-07T00:00:02.000Z");
    addContact(db, "u1", "email", "b@example.com", "2026-06-07T00:00:01.000Z");
    addContact(db, "u2", "email", "other@example.com");

    const u1 = listContacts(db, "u1");
    expect(u1.map((c) => c.value)).toEqual(["b@example.com", "a@example.com"]);
    expect(listContacts(db, "u2").map((c) => c.value)).toEqual(["other@example.com"]);
  });

  it("returns an empty array for a user with no contacts", () => {
    expect(listContacts(db, "u1")).toEqual([]);
  });
});

describe("contact-repo — addContact / findByNormalized / countContacts (US2)", () => {
  it("preserves the original case of the stored value (FR-013)", () => {
    const contact = addContact(db, "u1", "email", "Alice@Example.com");
    expect(contact.value).toBe("Alice@Example.com");
    expect(contact.type).toBe("email");
    expect(contact.id).toBeTruthy();
    expect(listContacts(db, "u1")[0]?.value).toBe("Alice@Example.com");
  });

  it("findByNormalized matches case-insensitively (FR-008)", () => {
    addContact(db, "u1", "email", "Alice@Example.com");
    expect(findByNormalized(db, "u1", "email", normalizeValue("ALICE@example.COM"))).not.toBeNull();
    expect(findByNormalized(db, "u1", "email", normalizeValue("bob@example.com"))).toBeNull();
    // Scoped per user — u2 has no such contact.
    expect(findByNormalized(db, "u2", "email", normalizeValue("alice@example.com"))).toBeNull();
  });

  it("countContacts returns the per-user count", () => {
    addContact(db, "u1", "email", "a@example.com");
    addContact(db, "u1", "email", "b@example.com");
    addContact(db, "u2", "email", "c@example.com");
    expect(countContacts(db, "u1")).toBe(2);
    expect(countContacts(db, "u2")).toBe(1);
  });
});

describe("contact-repo — removeContact (US3)", () => {
  it("deletes only the owner's matching row and reports success", () => {
    const c = addContact(db, "u1", "email", "a@example.com");
    expect(removeContact(db, "u1", c.id)).toBe(true);
    expect(listContacts(db, "u1")).toEqual([]);
  });

  it("is a no-op (returns false) for a missing id", () => {
    expect(removeContact(db, "u1", "does-not-exist")).toBe(false);
  });

  it("cannot delete another user's contact (returns false, leaves it intact) (FR-003)", () => {
    const c = addContact(db, "u1", "email", "a@example.com");
    expect(removeContact(db, "u2", c.id)).toBe(false);
    expect(listContacts(db, "u1").map((x) => x.value)).toEqual(["a@example.com"]);
  });
});

describe("contact-repo — serialized shape", () => {
  it("serializes exactly id/type/value/createdAt (no verification fields)", () => {
    const c = addContact(db, "u1", "email", "a@example.com");
    expect(Object.keys(c).sort()).toEqual(["createdAt", "id", "type", "value"]);
  });
});
