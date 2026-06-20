import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import {
  addContact,
  countContacts,
  findByNormalized,
  getContactById,
  listContacts,
  markVerified,
  normalizeValue,
  removeContact,
  setVerificationToken,
  findByVerificationHash,
} from "../../src/db/contact-repo";
import { hashVerificationToken } from "../../src/contacts/verification-token";

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

describe("contact-repo — verification (feature 009)", () => {
  const HASH = hashVerificationToken("a-raw-token");
  const EXPIRES = "2026-06-21T00:00:00.000Z";

  it("a freshly added contact serializes unverified by default (FR-002, SC-004)", () => {
    const c = addContact(db, "u1", "email", "a@example.com");
    expect(c.verified).toBe(false);
    expect(c.verifiedAt).toBeNull();
    expect(listContacts(db, "u1")[0]?.verified).toBe(false);
  });

  it("getContactById returns the caller's own contact, null for others' (FR-006)", () => {
    const c = addContact(db, "u1", "email", "a@example.com");
    expect(getContactById(db, "u1", c.id)?.id).toBe(c.id);
    expect(getContactById(db, "u2", c.id)).toBeNull();
    expect(getContactById(db, "u1", "missing")).toBeNull();
  });

  it("does NOT expose the token hash or expiry on the serialized contact (FR-002)", () => {
    const c = addContact(db, "u1", "email", "a@example.com");
    setVerificationToken(db, "u1", c.id, HASH, EXPIRES);
    const serialized = getContactById(db, "u1", c.id)!;
    expect(Object.keys(serialized).sort()).toEqual([
      "createdAt",
      "id",
      "type",
      "value",
      "verified",
      "verifiedAt",
    ]);
    expect(JSON.stringify(serialized)).not.toContain(HASH);
    expect(JSON.stringify(serialized)).not.toContain("a-raw-token");
  });

  it("setVerificationToken stores the hash + expiry and findByVerificationHash finds it", () => {
    const c = addContact(db, "u1", "email", "a@example.com");
    expect(setVerificationToken(db, "u1", c.id, HASH, EXPIRES)).toBe(true);
    const found = findByVerificationHash(db, HASH);
    expect(found?.id).toBe(c.id);
    expect(found?.expiresAt).toBe(EXPIRES);
    expect(found?.verifiedAt).toBeNull();
    // Public lookup never matches a non-stored hash.
    expect(findByVerificationHash(db, hashVerificationToken("other"))).toBeNull();
  });

  it("setVerificationToken cannot touch another user's contact", () => {
    const c = addContact(db, "u1", "email", "a@example.com");
    expect(setVerificationToken(db, "u2", c.id, HASH, EXPIRES)).toBe(false);
    expect(findByVerificationHash(db, HASH)).toBeNull();
  });

  it("markVerified sets verified_at, clears the token, and is single-use (FR-009)", () => {
    const c = addContact(db, "u1", "email", "a@example.com");
    setVerificationToken(db, "u1", c.id, HASH, EXPIRES);

    expect(markVerified(db, c.id, "2026-06-20T12:00:00.000Z")).toBe("verified");
    const after = getContactById(db, "u1", c.id)!;
    expect(after.verified).toBe(true);
    expect(after.verifiedAt).toBe("2026-06-20T12:00:00.000Z");
    // The token hash is burned → an old link no longer matches (single-use / replay-proof).
    expect(findByVerificationHash(db, HASH)).toBeNull();
  });

  it("markVerified is idempotent — a second call keeps the original timestamp (FR-011)", () => {
    const c = addContact(db, "u1", "email", "a@example.com");
    setVerificationToken(db, "u1", c.id, HASH, EXPIRES);
    markVerified(db, c.id, "2026-06-20T12:00:00.000Z");

    // Re-issue + re-open: already-verified, timestamp unchanged.
    const HASH2 = hashVerificationToken("second-token");
    setVerificationToken(db, "u1", c.id, HASH2, EXPIRES);
    expect(markVerified(db, c.id, "2026-06-25T00:00:00.000Z")).toBe("already_verified");
    expect(getContactById(db, "u1", c.id)!.verifiedAt).toBe("2026-06-20T12:00:00.000Z");
  });

  it("a resend supersedes the prior token — the old hash no longer matches (FR-005)", () => {
    const c = addContact(db, "u1", "email", "a@example.com");
    setVerificationToken(db, "u1", c.id, HASH, EXPIRES);
    const HASH2 = hashVerificationToken("resent-token");
    setVerificationToken(db, "u1", c.id, HASH2, EXPIRES);

    expect(findByVerificationHash(db, HASH)).toBeNull();
    expect(findByVerificationHash(db, HASH2)?.id).toBe(c.id);
  });

  it("a hand-inserted legacy row (null verification columns) is unverified by default (SC-004)", () => {
    db.prepare(
      `INSERT INTO contact (id, user_id, type, value, value_norm, created_at)
       VALUES ('legacy', 'u1', 'email', 'old@example.com', 'old@example.com', '2026-01-01T00:00:00.000Z')`,
    ).run();
    const legacy = getContactById(db, "u1", "legacy")!;
    expect(legacy.verified).toBe(false);
    expect(legacy.verifiedAt).toBeNull();
  });
});
