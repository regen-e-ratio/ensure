import { Router } from "express";
import type { Db } from "../db/index";
import type { Keyring } from "../crypto/keyring";
import { getGrantByTokenHash, markGrantViewed } from "../db/release-repo";
import { getNoteForOwner, NoteDecryptError } from "../db/note-repo";
import { hashToken } from "../deadman/tokens";
import { parseReleaseToken } from "../validation/release";

/** Collaborators the public release router needs: the keyring (to decrypt) and a clock. */
export interface ReleaseRouterDeps {
  keyring: Keyring;
  now?: () => Date;
}

/**
 * PUBLIC release-view router (feature 010), mounted at /api/release BEFORE the requireAuth-gated
 * mounts and behind the rate limiter. Authority is the unguessable grant token only — no session,
 * no caller-supplied id (FR-012).
 *
 *   GET /:token
 *     - parse the token (missing/malformed → generic not-available, 404)
 *     - hash it and look the grant up by hash (unknown → 404)
 *     - already viewed OR expired → 410 Gone (view-once / time-limited)
 *     - otherwise: decrypt the OWNER's note via the keyring (fail-closed — on NoteDecryptError
 *       return 500 and DO NOT mark viewed, so it is retryable and no plaintext leaks), then
 *       markGrantViewed and return { note } exactly once.
 *
 * The raw token and the note plaintext are never logged or echoed beyond the single 200 body.
 */
export function createReleaseRouter(db: Db, deps: ReleaseRouterDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.get("/:token", (req, res) => {
    const parsed = parseReleaseToken(req.params.token);
    if (!parsed.ok) {
      res.status(404).json({ error: "NOT_AVAILABLE", message: "This link is not available." });
      return;
    }

    const grant = getGrantByTokenHash(db, hashToken(parsed.token));
    if (!grant) {
      res.status(404).json({ error: "NOT_AVAILABLE", message: "This link is not available." });
      return;
    }

    // View-once + time-limited: a viewed or expired grant is gone (inclusive expiry).
    const expired = now().getTime() >= Date.parse(grant.expiresAt);
    if (grant.viewedAt != null || expired) {
      res.status(410).json({ error: "GONE", message: "This link is no longer available." });
      return;
    }

    // Decrypt the OWNER's note server-side, fail-closed. Decrypt BEFORE marking viewed so a
    // transient decrypt failure leaves the grant unviewed (retryable) and never leaks plaintext.
    let noteText: string;
    try {
      const note = getNoteForOwner(db, grant.ownerUserId, deps.keyring);
      if (!note) {
        // The owner has no note to deliver — treat as not-available without disclosing why.
        res.status(404).json({ error: "NOT_AVAILABLE", message: "This link is not available." });
        return;
      }
      noteText = note.text;
    } catch (err) {
      if (err instanceof NoteDecryptError) {
        res.status(500).json({
          error: "DECRYPT_FAILED",
          message: "This message could not be opened. Please try again.",
        });
        return;
      }
      throw err;
    }

    // Burn the token (single-use). If a concurrent open already consumed it, this returns false
    // and we treat it as gone rather than re-serving the note.
    const consumed = markGrantViewed(db, grant.id, now().toISOString());
    if (!consumed) {
      res.status(410).json({ error: "GONE", message: "This link is no longer available." });
      return;
    }

    res.status(200).json({ note: noteText });
  });

  return router;
}
