import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { openDb, type Db } from "../../src/db/index";
import { createKeyring } from "../../src/crypto/keyring";
import { TEST_AUTH_CONFIG, loginTestUser } from "../helpers/auth";

const k = (fill: number) => Buffer.alloc(32, fill).toString("base64");
const keyV1 = createKeyring(`1:${k(1)}`, "1");
const keyV1V2 = createKeyring(`1:${k(1)},2:${k(2)}`, "2"); // v1 readable, v2 active

let db: Db;

function keyVersionFor(userId = "e2e-user"): number {
  return (
    db.prepare("SELECT key_version FROM note WHERE user_id = ?").get(userId) as {
      key_version: number;
    }
  ).key_version;
}

beforeEach(() => {
  db = openDb(":memory:");
});

describe("lazy rotation on save (US3, FR-011, FR-012a)", () => {
  it("a note saved under v1 is re-encrypted to v2 the next time its owner saves", async () => {
    // Two apps share one DB; both trust the same JWT secret so a cookie works on either.
    const appV1 = createApp(db, {
      auth: TEST_AUTH_CONFIG,
      encryption: keyV1,
      enableTestReset: true,
    });
    const appV2 = createApp(db, {
      auth: TEST_AUTH_CONFIG,
      encryption: keyV1V2,
      enableTestReset: true,
    });
    const cookies = await loginTestUser(appV1);

    // Saved while only v1 exists → row is on v1.
    await request(appV1).put("/api/note").set("Cookie", cookies).send({ text: "before rotation" });
    expect(keyVersionFor()).toBe(1);

    // After v2 is introduced as active, the v1 note still reads correctly (mixed-version read).
    const readOld = await request(appV2).get("/api/note").set("Cookie", cookies);
    expect(readOld.body.note.text).toBe("before rotation");
    expect(keyVersionFor()).toBe(1); // a read does not migrate

    // The owner saves again → lazy migration to the active version v2.
    await request(appV2).put("/api/note").set("Cookie", cookies).send({ text: "after rotation" });
    expect(keyVersionFor()).toBe(2);

    const readNew = await request(appV2).get("/api/note").set("Cookie", cookies);
    expect(readNew.body.note.text).toBe("after rotation");
  });
});
