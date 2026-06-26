import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Db } from "../../src/db/index";
import type { EmailMessage, EmailProvider, ProviderResult } from "../../src/notifications/channels/email/provider";
import { createApp } from "../../src/app";
import { openDb } from "../../src/db/index";
import { createKeyring } from "../../src/crypto/keyring";
import { upsertNote } from "../../src/db/note-repo";
import { addContact } from "../../src/db/contact-repo";
import { createRelease, createGrants } from "../../src/db/release-repo";
import { mintToken, hashToken } from "../../src/deadman/tokens";
import { TEST_AUTH_CONFIG } from "../helpers/auth";

process.env.DEADMAN_TICK_DISABLED = "1";

const KEY = Buffer.alloc(32, 7).toString("base64");
const KEYRING = createKeyring(`1:${KEY}`, "1");

class SpyEmailProvider implements EmailProvider {
  public sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<ProviderResult> {
    this.sent.push(message);
    return { accepted: true, providerMessageId: "spy-1" };
  }
}

function seedUser(db: Db, id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, `${id}@example.com`, null, "2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z");
}

const NOW = "2026-06-20T00:00:00.000Z";
const FUTURE = "2030-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

/** Create a grant for `owner` (with note + contact) and return the raw token. */
function makeGrant(db: Db, owner: string, expiresAt: string, keyring = KEYRING): string {
  seedUser(db, owner);
  upsertNote(db, owner, "the secret note", keyring, NOW);
  const contact = addContact(db, owner, "email", "friend@example.com");
  const release = createRelease(db, owner, "schedule", NOW);
  const token = mintToken();
  createGrants(db, release.id, owner, [{ contactId: contact.id, tokenHash: hashToken(token) }], expiresAt, NOW);
  return token;
}

describe("GET /api/release/:token contract (feature 010, public)", () => {
  let app: Express;
  let db: Db;
  let provider: SpyEmailProvider;

  beforeEach(() => {
    db = openDb(":memory:");
    provider = new SpyEmailProvider();
    app = createApp(db, {
      auth: TEST_AUTH_CONFIG,
      encryption: KEYRING,
      emailProvider: provider,
      appBaseUrl: "https://app.example.test",
      enableTestReset: true,
      enableDeadmanTestMode: true,
    });
  });

  it("a valid, unviewed, unexpired grant → 200 with the decrypted note, viewed_at set", async () => {
    const token = makeGrant(db, "owner", FUTURE);
    const res = await request(app).get(`/api/release/${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ note: "the secret note" });

    const grant = db.prepare("SELECT viewed_at FROM release_grant").get() as { viewed_at: string | null };
    expect(grant.viewed_at).not.toBeNull();
  });

  it("requires no session — the recipient is not signed in", async () => {
    const token = makeGrant(db, "owner", FUTURE);
    const res = await request(app).get(`/api/release/${token}`); // no cookie
    expect(res.status).toBe(200);
  });

  it("a second open → 410 Gone (view-once), no content", async () => {
    const token = makeGrant(db, "owner", FUTURE);
    await request(app).get(`/api/release/${token}`);
    const res = await request(app).get(`/api/release/${token}`);
    expect(res.status).toBe(410);
    expect(res.body.note).toBeUndefined();
  });

  it("an expired grant → 410 Gone, viewed_at stays null", async () => {
    const token = makeGrant(db, "owner", PAST);
    const res = await request(app).get(`/api/release/${token}`);
    expect(res.status).toBe(410);
    const grant = db.prepare("SELECT viewed_at FROM release_grant").get() as { viewed_at: string | null };
    expect(grant.viewed_at).toBeNull();
  });

  it("an unknown token → 404 not-available, discloses nothing", async () => {
    const res = await request(app).get(`/api/release/${mintToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_AVAILABLE");
  });

  it("a malformed token → 404 not-available", async () => {
    const res = await request(app).get(`/api/release/not%20a%20valid%20token!`);
    expect(res.status).toBe(404);
  });

  it("a decrypt failure → 500 fail-closed, viewed_at NOT set, no plaintext", async () => {
    // Mint the grant under a keyring whose version the app keyring does not have → decrypt fails.
    const otherKeyring = createKeyring(`2:${Buffer.alloc(32, 9).toString("base64")}`, "2");
    const token = makeGrant(db, "owner", FUTURE, otherKeyring);

    const res = await request(app).get(`/api/release/${token}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("DECRYPT_FAILED");
    expect(JSON.stringify(res.body)).not.toContain("the secret note");

    // Retryable: the grant stays unviewed.
    const grant = db.prepare("SELECT viewed_at FROM release_grant").get() as { viewed_at: string | null };
    expect(grant.viewed_at).toBeNull();
  });

  it("never echoes the raw token in the response (FR-012, SC-008)", async () => {
    const token = makeGrant(db, "owner", FUTURE);
    const res = await request(app).get(`/api/release/${token}`);
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it("is rate-limited: a burst of requests is throttled with 429", async () => {
    // The limiter allows 30/min per IP; a burst of unknown tokens past that is throttled.
    let throttled = false;
    for (let i = 0; i < 60; i++) {
      const res = await request(app).get(`/api/release/${mintToken()}`);
      if (res.status === 429) {
        throttled = true;
        break;
      }
    }
    expect(throttled).toBe(true);
  });
});
