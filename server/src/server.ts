import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app";
import { openDb } from "./db/index";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.NOTE_DB_PATH ?? "./data/note.db";

if (DB_PATH !== ":memory:") {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

const db = openDb(DB_PATH);
const app = createApp(db, { enableTestReset: process.env.NOTE_ALLOW_TEST_RESET === "1" });

app.listen(PORT, () => {
  console.log(`Store-a-Note API listening on http://localhost:${PORT}`);
});
