import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { EmailMessage, EmailProvider, ProviderResult } from "../../src/notifications/channels/email/provider";
import { makeTestApp, loginTestUser } from "../helpers/auth";

// Keep the in-process dead-man timer off (carried over from feature 008).
process.env.DEADMAN_TICK_DISABLED = "1";

/** A spy email provider that records every message the dispatcher hands it. */
class SpyEmailProvider implements EmailProvider {
  public sent: EmailMessage[] = [];
  constructor(private readonly accept = true) {}
  async send(message: EmailMessage): Promise<ProviderResult> {
    this.sent.push(message);
    return this.accept
      ? { accepted: true, providerMessageId: "spy-1" }
      : { accepted: false, reason: "spy configured to fail" };
  }
}

const APP_BASE_URL = "https://app.example.test";

async function addContact(app: Express, cookies: string[], value: string): Promise<string> {
  const res = await request(app)
    .post("/api/contact")
    .set("Cookie", cookies)
    .send({ type: "email", value });
  return res.body.id as string;
}

/** Pull the verification token out of the captured email body. */
function tokenFromEmail(message: EmailMessage | undefined): string {
  if (!message) throw new Error("no captured email");
  const body = message.text ?? message.html ?? "";
  const match = body.match(/contact-verified\?token=([A-Za-z0-9_%-]+)/);
  if (!match?.[1]) throw new Error("no verification link in email body");
  return decodeURIComponent(match[1]);
}

describe("POST /api/contact/{id}/verify contract (feature 009, US1)", () => {
  let app: Express;
  let cookies: string[];
  let provider: SpyEmailProvider;

  beforeEach(async () => {
    provider = new SpyEmailProvider();
    ({ app } = makeTestApp({ emailProvider: provider, appBaseUrl: APP_BASE_URL }));
    cookies = await loginTestUser(app);
  });

  it("sends a verification email through the dispatcher to the contact address with an APP_BASE_URL token link", async () => {
    const id = await addContact(app, cookies, "friend@example.com");

    const res = await request(app).post(`/api/contact/${id}/verify`).set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });

    expect(provider.sent).toHaveLength(1);
    const email = provider.sent[0]!;
    expect(email.to).toBe("friend@example.com");
    const body = email.text ?? email.html ?? "";
    expect(body).toContain(`${APP_BASE_URL}/contact-verified?token=`);

    // The link carries an actual token, and that token does NOT appear as a stored hash anywhere.
    const token = tokenFromEmail(email);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it("rejects an unauthenticated send with 401 and dispatches no email (FR-007)", async () => {
    const id = await addContact(app, cookies, "friend@example.com");
    provider.sent = [];

    const res = await request(app).post(`/api/contact/${id}/verify`);
    expect(res.status).toBe(401);
    expect(provider.sent).toHaveLength(0);
  });

  it("treats a non-owned contact id as 404 with no email sent (FR-006)", async () => {
    const otherCookies = await loginTestUser(app, { sub: "u2", email: "u2@example.com" });
    const id = await addContact(app, otherCookies, "secret@example.com");
    provider.sent = [];

    const res = await request(app).post(`/api/contact/${id}/verify`).set("Cookie", cookies);
    expect(res.status).toBe(404);
    expect(provider.sent).toHaveLength(0);
  });

  it("treats an absent contact id as 404 with no email sent", async () => {
    const res = await request(app).post(`/api/contact/does-not-exist/verify`).set("Cookie", cookies);
    expect(res.status).toBe(404);
    expect(provider.sent).toHaveLength(0);
  });

  it("allows resending — each send dispatches a fresh email (FR-005)", async () => {
    const id = await addContact(app, cookies, "friend@example.com");

    await request(app).post(`/api/contact/${id}/verify`).set("Cookie", cookies);
    const first = tokenFromEmail(provider.sent[0]);

    const res = await request(app).post(`/api/contact/${id}/verify`).set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(provider.sent).toHaveLength(2);
    const second = tokenFromEmail(provider.sent[1]);
    expect(second).not.toBe(first);
  });

  it("surfaces a clear error (502) and leaves the contact unverified when the send fails (FR-016)", async () => {
    const failing = new SpyEmailProvider(false);
    const { app: failApp } = makeTestApp({ emailProvider: failing, appBaseUrl: APP_BASE_URL });
    const failCookies = await loginTestUser(failApp);
    const id = await addContact(failApp, failCookies, "friend@example.com");

    const res = await request(failApp).post(`/api/contact/${id}/verify`).set("Cookie", failCookies);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("EMAIL_SEND_FAILED");

    // The contact remains unverified.
    const list = await request(failApp).get("/api/contact").set("Cookie", failCookies);
    expect(list.body.contacts[0].verified).toBe(false);
  });

  it("resending to an already-verified contact is accepted and never clears verified_at (US4, FR-011)", async () => {
    const id = await addContact(app, cookies, "friend@example.com");
    await request(app).post(`/api/contact/${id}/verify`).set("Cookie", cookies);
    const token = tokenFromEmail(provider.sent[0]);
    await request(app).get(`/api/contact/verify?token=${encodeURIComponent(token)}`);

    const before = (await request(app).get("/api/contact").set("Cookie", cookies)).body.contacts[0]
      .verifiedAt;
    expect(before).not.toBeNull();

    // Resend → accepted; verified_at unchanged.
    const resend = await request(app).post(`/api/contact/${id}/verify`).set("Cookie", cookies);
    expect(resend.status).toBe(200);
    const after = (await request(app).get("/api/contact").set("Cookie", cookies)).body.contacts[0]
      .verifiedAt;
    expect(after).toBe(before);
  });

  it("never serializes the raw token on the contact (FR-012, SC-006)", async () => {
    const id = await addContact(app, cookies, "friend@example.com");
    await request(app).post(`/api/contact/${id}/verify`).set("Cookie", cookies);
    const token = tokenFromEmail(provider.sent[0]);

    const list = await request(app).get("/api/contact").set("Cookie", cookies);
    expect(JSON.stringify(list.body)).not.toContain(token);
  });
});
