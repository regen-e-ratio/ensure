import { Router } from "express";
import { CONTACT_VERIFICATION_TTL_SECONDS } from "@ensure/shared/constants";
import type { Db } from "../db/index";
import {
  addContact,
  countContacts,
  findByNormalized,
  getContactById,
  listContacts,
  normalizeValue,
  removeContact,
  setVerificationToken,
  CONTACT_LIMIT,
} from "../db/contact-repo";
import { parseContactInput } from "../validation/contact";
import { mintVerificationToken, hashVerificationToken } from "../contacts/verification-token";
import { buildVerificationEmail } from "../contacts/verification-email";
import type { EmailProvider } from "../notifications/channels/email/provider";
import { buildRegistry } from "../notifications/registry";
import { notify } from "../notifications/notifier";

/** Collaborators the authed contact router needs to send verification emails (feature 009). */
export interface ContactRouterDeps {
  /** Absolute base URL used to build the verification link placed in the email (APP_BASE_URL). */
  appBaseUrl: string;
  /** Email provider backing the generic notify() dispatcher (never called directly). */
  emailProvider: EmailProvider;
  /** Injectable clock (tests pass a fixed now); defaults to the real wall clock. */
  now?: () => Date;
}

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
export function createContactRouter(db: Db, deps: ContactRouterDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  const registry = buildRegistry(deps.emailProvider);

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

  // Send (or resend) a verification email to one of the caller's own contacts (feature 009,
  // FR-003/FR-005/FR-006). Scoped by req.user.id: a non-owned id is 404 with no email sent.
  router.post("/:id/verify", async (req, res) => {
    const userId = req.user!.id;

    const contact = getContactById(db, userId, req.params.id);
    if (!contact) {
      res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
      return;
    }

    // Mint a high-entropy token; store ONLY its hash + a future expiry (resend overwrites both).
    const token = mintVerificationToken();
    const tokenHash = hashVerificationToken(token);
    const issuedAt = now();
    const expiresAt = new Date(
      issuedAt.getTime() + CONTACT_VERIFICATION_TTL_SECONDS * 1000,
    ).toISOString();
    setVerificationToken(db, userId, contact.id, tokenHash, expiresAt);

    // Send the verification email through the generic dispatcher (email channel) — never a
    // provider directly. The body carries the one-time APP_BASE_URL link and no other secret.
    const email = buildVerificationEmail(deps.appBaseUrl, token, contact.value);
    const result = await notify(registry, {
      channel: "email",
      recipient: contact.value,
      content: { subject: email.subject, body: email.body, bodyFormat: "text" },
    });

    if (!result.ok || result.outcome.status !== "sent") {
      // Leave the contact unverified; surface a clear error and leak no token (FR-016).
      res.status(502).json({
        error: "EMAIL_SEND_FAILED",
        message: "Could not send the verification email. Please try again.",
      });
      return;
    }

    res.status(200).json({ sent: true });
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
