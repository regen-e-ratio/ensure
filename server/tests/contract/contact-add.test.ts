import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { CONTACT_LIMIT, CONTACT_MAX_LENGTH } from "@ensure/shared/constants";
import { makeTestApp, loginTestUser } from "../helpers/auth";

let app: Express;
let cookies: string[];

beforeEach(async () => {
  ({ app } = makeTestApp());
  cookies = await loginTestUser(app);
});

describe("POST /api/contact contract (US2)", () => {
  it("adds a valid email → 201 with the stored contact (original case echoed)", async () => {
    const res = await request(app)
      .post("/api/contact")
      .set("Cookie", cookies)
      .send({ type: "email", value: "Alice@Example.com" });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      "createdAt",
      "id",
      "type",
      "value",
    ]);
    expect(res.body.value).toBe("Alice@Example.com");
    expect(res.body.id).toBeTruthy();
  });

  it("rejects a non-email type → 400 VALIDATION_ERROR (FR-006)", async () => {
    const res = await request(app)
      .post("/api/contact")
      .set("Cookie", cookies)
      .send({ type: "phone", value: "+15555550123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("rejects a malformed email → 400 VALIDATION_ERROR (FR-007)", async () => {
    const res = await request(app)
      .post("/api/contact")
      .set("Cookie", cookies)
      .send({ type: "email", value: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it(`rejects a value longer than ${CONTACT_MAX_LENGTH} chars → 400 (FR-014)`, async () => {
    const tooLong = `${"a".repeat(CONTACT_MAX_LENGTH)}@example.com`;
    const res = await request(app)
      .post("/api/contact")
      .set("Cookie", cookies)
      .send({ type: "email", value: tooLong });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("rejects a case/whitespace-variant duplicate → 409 DUPLICATE_CONTACT (FR-008)", async () => {
    await request(app)
      .post("/api/contact")
      .set("Cookie", cookies)
      .send({ type: "email", value: "Alice@Example.com" });

    const dup = await request(app)
      .post("/api/contact")
      .set("Cookie", cookies)
      .send({ type: "email", value: "  alice@example.com  " });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("DUPLICATE_CONTACT");

    // The original is unchanged (still one contact, original case).
    const list = await request(app).get("/api/contact").set("Cookie", cookies);
    expect(list.body.contacts).toHaveLength(1);
    expect(list.body.contacts[0].value).toBe("Alice@Example.com");
  });

  it(`rejects the ${CONTACT_LIMIT + 1}th contact → 409 CONTACT_LIMIT_REACHED (FR-015)`, async () => {
    for (let i = 0; i < CONTACT_LIMIT; i++) {
      const res = await request(app)
        .post("/api/contact")
        .set("Cookie", cookies)
        .send({ type: "email", value: `user${i}@example.com` });
      expect(res.status).toBe(201);
    }
    const overflow = await request(app)
      .post("/api/contact")
      .set("Cookie", cookies)
      .send({ type: "email", value: "one-too-many@example.com" });
    expect(overflow.status).toBe(409);
    expect(overflow.body.error).toBe("CONTACT_LIMIT_REACHED");
  });

  it("rejects an unauthenticated request with 401 (FR-012)", async () => {
    const res = await request(app)
      .post("/api/contact")
      .send({ type: "email", value: "alice@example.com" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });
});
