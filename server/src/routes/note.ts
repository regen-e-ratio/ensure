import { Router } from "express";
import type { Db } from "../db/index";
import { getNote, upsertNote } from "../db/note-repo";
import { parseNoteInput } from "../validation/note";

/**
 * Router for the single note, mounted at /api/note.
 *   - PUT  (create/replace)  — User Story 1
 *   - GET  (read current)    — User Story 2
 */
export function createNoteRouter(db: Db): Router {
  const router = Router();

  // US2: read the current note (or null when none exists).
  router.get("/", (_req, res) => {
    res.status(200).json({ note: getNote(db) });
  });

  // US1: create or replace the note.
  router.put("/", (req, res) => {
    const parsed = parseNoteInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: parsed.message });
      return;
    }
    const note = upsertNote(db, parsed.text);
    res.status(200).json({ note });
  });

  return router;
}
