import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import { createKeyring } from "../../src/crypto/keyring";
import { runTestRelease } from "../../src/deadman/test-release";
import { upsertConfig, getConfig } from "../../src/deadman/config-repo";
import { addContact, markVerified } from "../../src/db/contact-repo";
import type { EmailMessage, EmailProvider, ProviderResult } from "../../src/notifications/channels/email/provider";

const KEYRING = createKeyring(`1:${Buffer.alloc(32, 7).toString("base64")}`, "1");

class SpyEmailProvider implements EmailProvider {
  public sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<ProviderResult> {
    this.sent.push(message);
    return { accepted: true, providerMessageId: "spy-1" };
  }
}

let db: Db;
let provider: SpyEmailProvider;

function seedUser(id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, `${id}@example.com`, null, "2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z");
}

const NOW = "2026-06-20T00:00:00.000Z";
const DEPS = () => ({ keyring: KEYRING, appBaseUrl: "https://app.example.test", emailProvider: provider });

beforeEach(() => {
  db = openDb(":memory:");
  provider = new SpyEmailProvider();
  seedUser("owner");
});

describe("runTestRelease (feature 010, US3)", () => {
  it("creates a manual_test release + grant to the owner's verified contact, emails a link", async () => {
    const c = addContact(db, "owner", "email", "owner-addr@example.com");
    markVerified(db, c.id, NOW);

    const grants = await runTestRelease(db, DEPS(), "owner", NOW);
    expect(grants).toBe(1);

    const releases = db.prepare("SELECT trigger FROM release WHERE user_id = ?").all("owner") as {
      trigger: string;
    }[];
    expect(releases).toHaveLength(1);
    expect(releases[0]!.trigger).toBe("manual_test");

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.to).toBe("owner-addr@example.com");
    expect(provider.sent[0]!.text).toMatch(/\/r\//);
  });

  it("does NOT change switch state", async () => {
    upsertConfig(db, "owner", { checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true }, NOW);
    const before = getConfig(db, "owner");

    const c = addContact(db, "owner", "email", "owner-addr@example.com");
    markVerified(db, c.id, NOW);
    await runTestRelease(db, DEPS(), "owner", NOW);

    expect(getConfig(db, "owner")?.state).toBe(before?.state);
    expect(getConfig(db, "owner")?.state).toBe("active");
  });

  it("returns 0 and creates nothing when the caller has no verified contact", async () => {
    addContact(db, "owner", "email", "unverified@example.com"); // not verified
    const grants = await runTestRelease(db, DEPS(), "owner", NOW);
    expect(grants).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM release").get() as { n: number }).n).toBe(0);
    expect(provider.sent).toHaveLength(0);
  });

  it("snapshots only the caller's own verified contacts", async () => {
    seedUser("other");
    const otherContact = addContact(db, "other", "email", "other@example.com");
    markVerified(db, otherContact.id, NOW);

    const own = addContact(db, "owner", "email", "own@example.com");
    markVerified(db, own.id, NOW);

    await runTestRelease(db, DEPS(), "owner", NOW);
    expect(provider.sent.map((m) => m.to)).toEqual(["own@example.com"]);
  });
});
