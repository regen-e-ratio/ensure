import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../readme-relevance.mjs";

// The classifier is the one piece of executable behavior in feature 003-readme-rework.
// A commit is "relevant" when staged paths touch a README-relevant area AND README.md
// itself is NOT staged (staging README suppresses the reminder). See data-model Entity 4
// and contracts/readme-and-hook-contract.md (Contract B).

test("app source change flags as relevant", () => {
  const { relevant, triggers } = classify(["server/src/auth/routes.ts"]);
  assert.equal(relevant, true);
  assert.deepEqual(triggers, ["server/src/auth/routes.ts"]);
});

test("root package.json change flags as relevant", () => {
  assert.equal(classify(["package.json"]).relevant, true);
});

test("workspace package.json change flags as relevant", () => {
  assert.equal(classify(["server/package.json"]).relevant, true);
});

test("client source (any extension) flags as relevant", () => {
  assert.equal(classify(["client/src/styles.css"]).relevant, true);
});

test("contract, e2e, config and .env.example changes flag as relevant", () => {
  assert.equal(classify(["contracts/openapi.yaml"]).relevant, true);
  assert.equal(classify(["e2e/auth.spec.ts"]).relevant, true);
  assert.equal(classify(["playwright.config.ts"]).relevant, true);
  assert.equal(classify(["eslint.config.js"]).relevant, true);
  assert.equal(classify(["tsconfig.base.json"]).relevant, true);
  assert.equal(classify(["server/.env.example"]).relevant, true);
});

test("staging README.md suppresses the flag even with relevant files", () => {
  const { relevant, triggers } = classify(["README.md", "server/src/app.ts"]);
  assert.equal(relevant, false);
  assert.deepEqual(triggers, []);
});

test("spec/doc-only changes are not relevant", () => {
  assert.equal(classify(["specs/003-readme-rework/plan.md"]).relevant, false);
});

test("unrelated files are not relevant", () => {
  assert.equal(classify(["CLAUDE.md"]).relevant, false);
  assert.equal(classify(["data/note.db"]).relevant, false);
});

test("empty stage is not relevant", () => {
  assert.equal(classify([]).relevant, false);
});
