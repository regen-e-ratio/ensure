import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Db } from "../../src/db/index";
import type { EmailMessage, EmailProvider, ProviderResult } from "../../src/notifications/channels/email/provider";
import { setVerificationToken } from "../../src/db/contact-repo";
import { hashVerificationToken } from "../../src/contacts/verification-token";
import { makeTestApp, loginTestUser } from "../helpers/auth";

process.env.DEADMAN_TICK_DISABLED = "1";

class SpyEmailProvider implements EmailProvider {
  public sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<ProviderResult> {
    this.sent.push(message);
    return { accepted: true, providerMessageId: "spy-1" };
  }
}

const APP_BASE_URL = "https://app.example.test";

function tokenFromEmail(message: EmailMessage | undefined): string {
  if (!message) throw new Error("no captured email");
  const body = message.text ?? message.html ?? "";
  const match = body.match(/contact-verified\?token=([A-Za-z0-9_%-]+)/);
  if (!match?.[1]) throw new Error("no verification link in email body");
  return decodeURIComponent(match[1]);
}

describe("GET /api/contact/verify contract (feature 009, public)", () => {
  let app: Express;
  let db: Db;
  let cookies: string[];
  let provider: SpyEmailProvider;

  beforeEach(async () => {
    provider = new SpyEmailProvider();
    ({ app, db } = makeTestApp({ emailProvider: provider, appBaseUrl: APP_BASE_URL }));
    cookies = await loginTestUser(app);
  });

  async function addAndSend(value: string): Promise<{ id: string; token: string }> {
    const add = await request(app)
      .post("/api/contact")
      .set("Cookie", cookies)
      .send({ type: "email", value });
    const id = add.body.id as string;
    await request(app).post(`/api/contact/${id}/verify`).set("Cookie", cookies);
    const token = tokenFromEmail(provider.sent[provider.sent.length - 1]);
    return { id, token };
  }

  it("a valid fresh token → verified, and the contact serializes verified: true (US1)", async () => {
    const { token } = await addAndSend("friend@example.com");

    const res = await request(app).get(`/api/contact/verify?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "verified" });

    const list = await request(app).get("/api/contact").set("Cookie", cookies);
    expect(list.body.contacts[0].verified).toBe(true);
    expect(list.body.contacts[0].verifiedAt).not.toBeNull();
  });

  it("requires no session — the recipient is not signed in (FR-008)", async () => {
    const { token } = await addAndSend("friend@example.com");
    // No cookie attached.
    const res = await request(app).get(`/api/contact/verify?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("verified");
  });

  it("an expired token → invalid_or_expired, contact stays unverified (US3, FR-009/FR-010)", async () => {
    const add = await request(app)
      .post("/api/contact")
      .set("Cookie", cookies)
      .send({ type: "email", value: "friend@example.com" });
    const id = add.body.id as string;

    // Store a token whose expiry is already in the past.
    const rawToken = "expired-raw-token";
    setVerificationToken(db, "e2e-user", id, hashVerificationToken(rawToken), "2000-01-01T00:00:00.000Z");

    const res = await request(app).get(`/api/contact/verify?token=${encodeURIComponent(rawToken)}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("invalid_or_expired");

    const list = await request(app).get("/api/contact").set("Cookie", cookies);
    expect(list.body.contacts[0].verified).toBe(false);
  });

  it("replay: opening a valid token twice → second is invalid_or_expired, verified_at unchanged (US3)", async () => {
    const { token } = await addAndSend("friend@example.com");

    const first = await request(app).get(`/api/contact/verify?token=${encodeURIComponent(token)}`);
    expect(first.body.status).toBe("verified");
    const verifiedAt = (await request(app).get("/api/contact").set("Cookie", cookies)).body
      .contacts[0].verifiedAt;

    const second = await request(app).get(`/api/contact/verify?token=${encodeURIComponent(token)}`);
    expect(second.body.status).toBe("invalid_or_expired");

    const after = (await request(app).get("/api/contact").set("Cookie", cookies)).body.contacts[0]
      .verifiedAt;
    expect(after).toBe(verifiedAt);
  });

  it("a resend invalidates the prior link (FR-005)", async () => {
    const { id, token: oldToken } = await addAndSend("friend@example.com");
    await request(app).post(`/api/contact/${id}/verify`).set("Cookie", cookies); // resend

    const res = await request(app).get(`/api/contact/verify?token=${encodeURIComponent(oldToken)}`);
    expect(res.body.status).toBe("invalid_or_expired");

    const newToken = tokenFromEmail(provider.sent[provider.sent.length - 1]);
    const ok = await request(app).get(`/api/contact/verify?token=${encodeURIComponent(newToken)}`);
    expect(ok.body.status).toBe("verified");
  });

  it("a missing token → invalid_or_expired (no disclosure) (FR-010)", async () => {
    const res = await request(app).get(`/api/contact/verify`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("invalid_or_expired");
  });

  it("an unknown / random token → invalid_or_expired (no contact/owner disclosure) (FR-010, SC-002)", async () => {
    const res = await request(app).get(`/api/contact/verify?token=totally-made-up-token`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "invalid_or_expired" });
    // The body discloses nothing beyond the generic status.
    expect(Object.keys(res.body)).toEqual(["status"]);
  });

  it("opening a valid current link for an already-verified contact → already_verified, unchanged timestamp (US4, FR-011)", async () => {
    const { id, token } = await addAndSend("friend@example.com");
    await request(app).get(`/api/contact/verify?token=${encodeURIComponent(token)}`); // first verify
    const verifiedAt = (await request(app).get("/api/contact").set("Cookie", cookies)).body
      .contacts[0].verifiedAt;

    // Re-issue a fresh, valid link, then open it: already verified, timestamp unchanged.
    await request(app).post(`/api/contact/${id}/verify`).set("Cookie", cookies);
    const freshToken = tokenFromEmail(provider.sent[provider.sent.length - 1]);
    const res = await request(app).get(`/api/contact/verify?token=${encodeURIComponent(freshToken)}`);
    expect(res.body.status).toBe("already_verified");

    const after = (await request(app).get("/api/contact").set("Cookie", cookies)).body.contacts[0]
      .verifiedAt;
    expect(after).toBe(verifiedAt);
  });

  it("never echoes the raw token in the response (FR-012, SC-006)", async () => {
    const { token } = await addAndSend("friend@example.com");
    const res = await request(app).get(`/api/contact/verify?token=${encodeURIComponent(token)}`);
    expect(JSON.stringify(res.body)).not.toContain(token);
  });
});
