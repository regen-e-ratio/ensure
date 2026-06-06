// Pre-commit relevance classifier for feature 003-readme-rework.
//
// The README is bounded to four areas — Architecture, Run, Manual setup, Tests. When a commit
// touches code/config that can affect one of those areas WITHOUT also updating README.md, this
// reminds the author to update it (or proceed deliberately with `git commit --no-verify`).
//
// `classify(stagedPaths)` is a pure function (unit-tested). Run as a script, it reads the staged
// file list from stdin (`git diff --cached --name-only`) and exits 1 with a warning when relevant.

import { Buffer } from "node:buffer";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** Directory prefixes whose contents affect architecture / run / tests. */
const RELEVANT_PREFIXES = ["server/src/", "client/src/", "shared/src/", "contracts/", "e2e/"];

/** Exact repo-root files that affect run/test behavior. */
const RELEVANT_EXACT = new Set(["playwright.config.ts", "eslint.config.js", "package.json"]);

/** True if a single staged path falls within a README-relevant area. */
function isRelevantPath(path) {
  if (RELEVANT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (RELEVANT_EXACT.has(path)) return true;
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  if (base === "package.json") return true; // any workspace package.json (scripts/deps)
  if (base === ".env.example") return true; // **/.env.example — manual-setup surface
  if (/^tsconfig.*\.json$/.test(base)) return true; // tsconfig*.json
  return false;
}

/**
 * Classify a set of staged paths.
 * @param {string[]} stagedPaths
 * @returns {{ relevant: boolean, triggers: string[] }}
 *   `relevant` is false when README.md is itself staged (the reminder is satisfied).
 */
export function classify(stagedPaths) {
  const paths = stagedPaths.filter((p) => p && p.length > 0);
  if (paths.includes("README.md")) return { relevant: false, triggers: [] };
  const triggers = paths.filter(isRelevantPath);
  return { relevant: triggers.length > 0, triggers };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const input = await readStdin();
  const staged = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const { relevant, triggers } = classify(staged);
  if (!relevant) process.exit(0);

  const list = triggers.map((t) => `  - ${t}`).join("\n");
  process.stderr.write(
    [
      "",
      "⚠  README check: staged changes touch README-relevant areas but README.md is not staged:",
      list,
      "",
      "  The README is the single source of truth for: Architecture, Run, Manual setup, Tests.",
      "  If this change affects any of those, update README.md and re-stage it.",
      "  If it genuinely does not, re-run with:  git commit --no-verify",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
