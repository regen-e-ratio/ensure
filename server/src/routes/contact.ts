import { Router } from "express";
import type { Db } from "../db/index";
import {
  addContact,
  countContacts,
  findByNormalized,
  listContacts,
  normalizeValue,
  removeContact,
  CONTACT_LIMIT,
} from "../db/contact-repo";
import { parseContactInput } from "../validation/contact";

/**
 * Router for the caller's own contacts, mounted at /api/contact behind `requireAuth`.
 *   - GET    /     — list the caller's contacts (US1)
 *   - POST   /     — add an email contact (US2)
 *   - DELETE /:id  — remove a contact (US3)
 *
 * The owner is always `req.user.id` (set by `requireAuth`); no endpoint accepts a target
 * user id, so addressing another user's contacts is structurally impossible
 * (FR-003, FR-012).
 */
export function createContactRouter(db: Db): Router {
  const router = Router();

  // List the caller's own contacts (US1).
  router.get("/", (req, res) => {
    // requireAuth guarantees req.user is set before this handler runs.
    const userId = req.user!.id;
    res.status(200).json({ contacts: listContacts(db, userId) });
  });

  // Add an email contact (US2): validate → reject duplicates → enforce the limit → insert.
  router.post("/", (req, res) => {
    const userId = req.user!.id;

    const parsed = parseContactInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: parsed.message });
      return;
    }

    // Case-insensitive duplicate check (FR-008).
    if (findByNormalized(db, userId, parsed.type, normalizeValue(parsed.value))) {
      res.status(409).json({
        error: "DUPLICATE_CONTACT",
        message: "That contact is already in your list.",
      });
      return;
    }

    // Per-user cap (FR-015).
    if (countContacts(db, userId) >= CONTACT_LIMIT) {
      res.status(409).json({
        error: "CONTACT_LIMIT_REACHED",
        message: `You can have at most ${CONTACT_LIMIT} contacts.`,
      });
      return;
    }

    const contact = addContact(db, userId, parsed.type, parsed.value);
    res.status(201).json(contact);
  });

  // Remove a contact (US3). Idempotent: 204 whether or not a matching owned row existed,
  // so another user's id behaves exactly like a non-existent one (FR-003, US3 #3).
  router.delete("/:id", (req, res) => {
    const userId = req.user!.id;
    removeContact(db, userId, req.params.id);
    res.status(204).end();
  });

  return router;
}
