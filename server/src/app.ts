import express, { type Express } from "express";
import type { Db } from "./db/index";
import { clearNote } from "./db/note-repo";
import { createNoteRouter } from "./routes/note";

export interface AppOptions {
  /** Enables a non-contract POST /api/test/reset route for clearing state in e2e runs. Never on in production. */
  enableTestReset?: boolean;
}

/**
 * Build the Express app around an injected database. No network listening happens
 * here, so tests can exercise the app in-process (e.g. with Supertest).
 */
export function createApp(db: Db, options: AppOptions = {}): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/note", createNoteRouter(db));

  if (options.enableTestReset) {
    app.post("/api/test/reset", (_req, res) => {
      clearNote(db);
      res.status(204).end();
    });
  }

  return app;
}
