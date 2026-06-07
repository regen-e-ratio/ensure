import { Router } from "express";
import type { Db } from "../db/index";
import type { Keyring } from "../crypto/keyring";
import { getNote, upsertNote, NoteDecryptError } from "../db/note-repo";
import { parseNoteInput } from "../validation/note";

/**
 * Router for the caller's own note, mounted at /api/note behind `requireAuth`.
 *   - GET  — read the caller's own note (or null)
 *   - PUT  — create/replace the caller's own note
 *
 * The owner is always `req.user.id` (set by `requireAuth`); no endpoint accepts a
 * target user id, so addressing another user's note is structurally impossible
 * (FR-002…FR-005). Content is encrypted at rest via the injected keyring.
 */
export function createNoteRouter(db: Db, keyring: Keyring): Router {
  const router = Router();

  // Read the caller's own note. A failure to decrypt fails closed (FR-015): map it to
  // a generic 500 and never return plaintext or details about the stored content.
  router.get("/", (req, res) => {
    // requireAuth guarantees req.user is set before this handler runs.
    const userId = req.user!.id;
    try {
      res.status(200).json({ note: getNote(db, userId, keyring) });
    } catch (err) {
      if (err instanceof NoteDecryptError) {
        res.status(500).json({
          error: "NOTE_DECRYPT_FAILED",
          message: "The note could not be decrypted.",
        });
        return;
      }
      throw err;
    }
  });

  // Create or replace the caller's own note. Text is validated (length ≤ 10,000,
  // non-empty) before encryption (FR-017); the save (re-)encrypts with the active key.
  router.put("/", (req, res) => {
    const userId = req.user!.id;
    const parsed = parseNoteInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: parsed.message });
      return;
    }
    const note = upsertNote(db, userId, parsed.text, keyring);
    res.status(200).json({ note });
  });

  return router;
}
