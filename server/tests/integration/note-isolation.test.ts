import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser } from "../helpers/auth";

let app: Express;

beforeEach(() => {
  ({ app } = makeTestApp());
});

/** Sign in a distinct user (distinct Google `sub`) and return their cookies. */
async function loginAs(sub: string): Promise<string[]> {
  return loginTestUser(app, { sub, email: `${sub}@example.com`, name: sub });
}

describe("per-user note isolation (US1)", () => {
  it("each user reads only their own note, never the other's (FR-003, FR-005)", async () => {
    const alice = await loginAs("alice");
    const bob = await loginAs("bob");

    await request(app).put("/api/note").set("Cookie", alice).send({ text: "alpha" });
    await request(app).put("/api/note").set("Cookie", bob).send({ text: "beta" });

    const aliceGet = await request(app).get("/api/note").set("Cookie", alice);
    const bobGet = await request(app).get("/api/note").set("Cookie", bob);

    expect(aliceGet.body.note.text).toBe("alpha");
    expect(bobGet.body.note.text).toBe("beta");
    expect(JSON.stringify(aliceGet.body)).not.toContain("beta");
    expect(JSON.stringify(bobGet.body)).not.toContain("alpha");
  });

  it("a user who never saved sees their own empty state, not another's note (FR-006)", async () => {
    const alice = await loginAs("alice");
    await request(app).put("/api/note").set("Cookie", alice).send({ text: "alpha" });

    const carol = await loginAs("carol");
    const carolGet = await request(app).get("/api/note").set("Cookie", carol);
    expect(carolGet.status).toBe(200);
    expect(carolGet.body).toEqual({ note: null });
  });

  it("a user's update never affects another user's note", async () => {
    const alice = await loginAs("alice");
    const bob = await loginAs("bob");
    await request(app).put("/api/note").set("Cookie", alice).send({ text: "alpha-1" });
    await request(app).put("/api/note").set("Cookie", bob).send({ text: "beta-1" });

    await request(app).put("/api/note").set("Cookie", alice).send({ text: "alpha-2" });

    const bobGet = await request(app).get("/api/note").set("Cookie", bob);
    expect(bobGet.body.note.text).toBe("beta-1");
  });
});
