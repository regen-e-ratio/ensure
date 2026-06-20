import type { Db } from "../db/index";
import type { EmailProvider } from "../notifications/channels/email/provider";
import { buildRegistry } from "../notifications/registry";
import { notify } from "../notifications/notifier";
import { getUser } from "../db/user-repo";
import { listVerifiedContacts } from "../db/contact-repo";
import { buildReleaseEmail } from "./release-email";
import type { Deps, ReminderMessage, ReleaseRecipient } from "./engine";

/** Default absolute base URL used to build email links when none is supplied. */
const DEFAULT_APP_BASE_URL = "http://localhost:5173";

/**
 * Build the engine's injected {@link Deps} from the real collaborators: a notifier closure over
 * the generic `notify(buildRegistry(emailProvider), …)` dispatcher (never a provider directly), a
 * `Date` clock, a `userEmailFor` resolver reading the user's account email, and (feature 010) the
 * `release` capability — a verified-contact snapshot lister plus a per-grant release-email sender
 * that emails one tokenized `${appBaseUrl}/r/<token>` link via the same dispatcher and returns the
 * provider message id (throwing on failure). Shared by the boot path (`server.ts`), the
 * `deadman:tick` CLI, and the fast-forward seam so all drive the engine identically. Email
 * body/subject carry no secrets (FR-017) and no note plaintext (FR-002).
 */
export function buildDeadmanDeps(
  db: Db,
  emailProvider: EmailProvider,
  appBaseUrl: string = DEFAULT_APP_BASE_URL,
): Deps {
  const registry = buildRegistry(emailProvider);

  return {
    now: () => new Date(),
    userEmailFor: (userId: string) => getUser(db, userId)?.email ?? null,
    notify: async (message: ReminderMessage): Promise<void> => {
      await notify(registry, {
        channel: "email",
        recipient: message.recipient,
        content: { subject: message.subject, body: message.body, bodyFormat: "text" },
      });
    },
    release: {
      listVerifiedContacts: (userId: string): ReleaseRecipient[] =>
        listVerifiedContacts(db, userId).map((c) => ({ contactId: c.id, address: c.value })),
      sendReleaseEmail: async (recipient: string, token: string): Promise<string | null> => {
        const email = buildReleaseEmail(appBaseUrl, token, recipient);
        const result = await notify(registry, {
          channel: "email",
          recipient,
          content: { subject: email.subject, body: email.body, bodyFormat: "text" },
        });
        if (!result.ok || result.outcome.status !== "sent") {
          // Surface as a thrown failure so the engine records this grant's email_status='failed'.
          throw new Error("release email not sent");
        }
        return result.outcome.providerMessageId ?? null;
      },
    },
  };
}
