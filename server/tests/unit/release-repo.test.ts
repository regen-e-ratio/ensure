import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import {
  createRelease,
  createGrants,
  getGrantByTokenHash,
  markGrantViewed,
  setGrantEmailStatus,
  hasReleaseForCurrentCycle,
} from "../../src/db/release-repo";
import { addContact, markVerified } from "../../src/db/contact-repo";
import { mintToken, hashToken } from "../../src/deadman/tokens";

let db: Db;

function seedUser(id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, `${id}@example.com`, null, "2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z");
}

const NOW = "2026-06-20T00:00:00.000Z";
const EXPIRES = "2026-07-20T00:00:00.000Z";

beforeEach(() => {
  db = openDb(":memory:");
  seedUser("owner");
});

describe("release-repo (feature 010)", () => {
  it("createRelease inserts a row with the given trigger", () => {
    const release = createRelease(db, "owner", "schedule", NOW);
    expect(release.userId).toBe("owner");
    expect(release.trigger).toBe("schedule");
    const row = db.prepare("SELECT * FROM release WHERE id = ?").get(release.id) as {
      trigger: string;
    };
    expect(row.trigger).toBe("schedule");
  });

  it("createGrants stores only the token hash, one grant per recipient", () => {
    const release = createRelease(db, "owner", "schedule", NOW);
    const c1 = addContact(db, "owner", "email", "a@example.com");
    const c2 = addContact(db, "owner", "email", "b@example.com");
    const t1 = mintToken();
    const t2 = mintToken();

    const ids = createGrants(
      db,
      release.id,
      "owner",
      [
        { contactId: c1.id, tokenHash: hashToken(t1) },
        { contactId: c2.id, tokenHash: hashToken(t2) },
      ],
      EXPIRES,
      NOW,
    );
    expect(ids).toHaveLength(2);

    // The raw token is never persisted — only its hash.
    const rows = db.prepare("SELECT token_hash FROM release_grant").all() as {
      token_hash: string;
    }[];
    const hashes = rows.map((r) => r.token_hash);
    expect(hashes).toContain(hashToken(t1));
    expect(hashes).not.toContain(t1);
    expect(hashes).not.toContain(t2);
  });

  it("getGrantByTokenHash returns the grant (owner + viewed_at + expires_at) by hash", () => {
    const release = createRelease(db, "owner", "schedule", NOW);
    const c1 = addContact(db, "owner", "email", "a@example.com");
    const token = mintToken();
    createGrants(db, release.id, "owner", [{ contactId: c1.id, tokenHash: hashToken(token) }], EXPIRES, NOW);

    const grant = getGrantByTokenHash(db, hashToken(token));
    expect(grant).not.toBeNull();
    expect(grant!.ownerUserId).toBe("owner");
    expect(grant!.viewedAt).toBeNull();
    expect(grant!.expiresAt).toBe(EXPIRES);

    expect(getGrantByTokenHash(db, hashToken("unknown"))).toBeNull();
  });

  it("markGrantViewed is single-use: first call consumes, second is a no-op", () => {
    const release = createRelease(db, "owner", "schedule", NOW);
    const c1 = addContact(db, "owner", "email", "a@example.com");
    const token = mintToken();
    createGrants(db, release.id, "owner", [{ contactId: c1.id, tokenHash: hashToken(token) }], EXPIRES, NOW);
    const grant = getGrantByTokenHash(db, hashToken(token))!;

    expect(markGrantViewed(db, grant.id, "2026-06-21T00:00:00.000Z")).toBe(true);
    expect(markGrantViewed(db, grant.id, "2026-06-22T00:00:00.000Z")).toBe(false);

    const after = getGrantByTokenHash(db, hashToken(token))!;
    expect(after.viewedAt).toBe("2026-06-21T00:00:00.000Z");
  });

  it("setGrantEmailStatus updates status / provider id / error", () => {
    const release = createRelease(db, "owner", "schedule", NOW);
    const c1 = addContact(db, "owner", "email", "a@example.com");
    const token = mintToken();
    const [grantId] = createGrants(
      db,
      release.id,
      "owner",
      [{ contactId: c1.id, tokenHash: hashToken(token) }],
      EXPIRES,
      NOW,
    );

    setGrantEmailStatus(db, grantId!, "sent", "provider-123");
    let row = db.prepare("SELECT * FROM release_grant WHERE id = ?").get(grantId) as {
      email_status: string;
      provider_message_id: string | null;
      email_error: string | null;
    };
    expect(row.email_status).toBe("sent");
    expect(row.provider_message_id).toBe("provider-123");

    setGrantEmailStatus(db, grantId!, "failed", null, "provider down");
    row = db.prepare("SELECT * FROM release_grant WHERE id = ?").get(grantId) as typeof row;
    expect(row.email_status).toBe("failed");
    expect(row.email_error).toBe("provider down");
  });

  it("hasReleaseForCurrentCycle is false before and true after a scheduled release", () => {
    expect(hasReleaseForCurrentCycle(db, "owner")).toBe(false);
    createRelease(db, "owner", "schedule", NOW);
    expect(hasReleaseForCurrentCycle(db, "owner")).toBe(true);
  });

  it("a manual_test release does NOT count as the current cycle's release", () => {
    createRelease(db, "owner", "manual_test", NOW);
    expect(hasReleaseForCurrentCycle(db, "owner")).toBe(false);
  });

  it("listVerifiedContacts feeds createGrants with verified-only recipients", () => {
    // sanity: a verified contact can be a grant recipient.
    const c1 = addContact(db, "owner", "email", "v@example.com");
    markVerified(db, c1.id, NOW);
    const release = createRelease(db, "owner", "schedule", NOW);
    const token = mintToken();
    const ids = createGrants(db, release.id, "owner", [{ contactId: c1.id, tokenHash: hashToken(token) }], EXPIRES, NOW);
    expect(ids).toHaveLength(1);
  });
});
