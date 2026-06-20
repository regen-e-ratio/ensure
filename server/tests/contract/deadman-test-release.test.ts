import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Db } from "../../src/db/index";
import type { EmailMessage, EmailProvider, ProviderResult } from "../../src/notifications/channels/email/provider";
import { makeTestApp, loginTestUser } from "../helpers/auth";

process.env.DEADMAN_TICK_DISABLED = "1";

class SpyEmailProvider implements EmailProvider {
  public sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<ProviderResult> {
    this.sent.push(message);
    return { accepted: true, providerMessageId: "spy-1" };
  }
}

describe("POST /api/deadman/test-release contract (feature 010, US3)", () => {
  let app: Express;
  let db: Db;
  let cookies: string[];
  let provider: SpyEmailProvider;

  beforeEach(async () => {
    provider = new SpyEmailProvider();
    ({ app, db } = makeTestApp({ emailProvider: provider, appBaseUrl: "https://app.example.test" }));
    cookies = await loginTestUser(app);
  });

  async function addVerifiedContact(value: string): Promise<void> {
    const add = await request(app).post("/api/contact").set("Cookie", cookies).send({ type: "email", value });
    const id = add.body.id as string;
    await request(app).post(`/api/contact/${id}/verify`).set("Cookie", cookies);
    // Open the captured verification link to mark it verified.
    const body = provider.sent[provider.sent.length - 1]!.text ?? "";
    const token = decodeURIComponent(body.match(/contact-verified\?token=([A-Za-z0-9_%-]+)/)![1]!);
    await request(app).get(`/api/contact/verify?token=${encodeURIComponent(token)}`);
  }

  it("with a verified contact → 200, a manual_test release + grant, email sent, state unchanged", async () => {
    // Arm the switch first so we can assert state is unchanged.
    await request(app)
      .put("/api/deadman/config")
      .set("Cookie", cookies)
      .send({ checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true });
    const stateBefore = (await request(app).get("/api/deadman").set("Cookie", cookies)).body.state;

    await addVerifiedContact("me@example.com");
    const sentBefore = provider.sent.length;

    const res = await request(app).post("/api/deadman/test-release").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ grants: 1 });

    // A manual_test release exists.
    const releases = db.prepare("SELECT trigger FROM release").all() as { trigger: string }[];
    expect(releases.some((r) => r.trigger === "manual_test")).toBe(true);

    // An email went to the owner's own verified address.
    expect(provider.sent.length).toBe(sentBefore + 1);
    expect(provider.sent[provider.sent.length - 1]!.to).toBe("me@example.com");

    // Switch state is unchanged.
    const stateAfter = (await request(app).get("/api/deadman").set("Cookie", cookies)).body.state;
    expect(stateAfter).toBe(stateBefore);
    expect(stateAfter).toBe("active");
  });

  it("no cookie → 401, no email", async () => {
    const res = await request(app).post("/api/deadman/test-release");
    expect(res.status).toBe(401);
    expect(provider.sent).toHaveLength(0);
  });

  it("no verified contact → 409, no email", async () => {
    // An unverified contact does not count.
    await request(app).post("/api/contact").set("Cookie", cookies).send({ type: "email", value: "x@example.com" });
    const res = await request(app).post("/api/deadman/test-release").set("Cookie", cookies);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("NO_VERIFIED_CONTACT");
    expect(db.prepare("SELECT COUNT(*) AS n FROM release").get()).toEqual({ n: 0 });
  });

  it("the test-release email link can be opened once to read the note", async () => {
    // Owner writes a note + has a verified contact.
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: "preview me" });
    await addVerifiedContact("me@example.com");
    await request(app).post("/api/deadman/test-release").set("Cookie", cookies);

    const body = provider.sent[provider.sent.length - 1]!.text ?? "";
    const token = decodeURIComponent(body.match(/\/r\/([A-Za-z0-9_-]+)/)![1]!);

    const open = await request(app).get(`/api/release/${token}`);
    expect(open.status).toBe(200);
    expect(open.body.note).toBe("preview me");

    const reopen = await request(app).get(`/api/release/${token}`);
    expect(reopen.status).toBe(410);
  });
});
