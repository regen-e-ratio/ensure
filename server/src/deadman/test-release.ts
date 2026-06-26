import type { Db } from "../db/index";
import type { EmailProvider } from "../notifications/channels/email/provider";
import { buildRegistry } from "../notifications/registry";
import { notify } from "../notifications/notifier";
import { listContacts } from "../db/contact-repo";
import { buildReleaseEmail } from "./release-email";
import { deliverRelease, type ReleaseDeps, type ReleaseRecipient } from "./engine";

/** The collaborators a manual test-release needs (feature 010, US3). */
export interface TestReleaseDeps {
  keyring: import("../crypto/keyring").Keyring;
  appBaseUrl: string;
  emailProvider: EmailProvider;
}

/**
 * Run a manual test-release for `userId` (feature 010, US3): if the caller has at least one
 * contact, create a `manual_test` release, mint one one-time grant per OWN contact, and email
 * each a tokenized `${appBaseUrl}/r/<token>` link via the generic notify() dispatcher (recording
 * per-grant email status). It NEVER changes switch state. Returns the number of grants created
 * (0 when the caller has no contact, so the route can 409 without creating an empty release).
 * The keyring is unused on send (decrypt happens on open); it is accepted so the deps mirror the
 * engine's release deps for future symmetry.
 */
export async function runTestRelease(
  db: Db,
  deps: TestReleaseDeps,
  userId: string,
  nowIso: string,
): Promise<number> {
  // Snapshot the caller's own contacts first; with none, create nothing.
  const contacts = listContacts(db, userId);
  if (contacts.length === 0) {
    return 0;
  }

  const registry = buildRegistry(deps.emailProvider);
  const release: ReleaseDeps = {
    listContacts: (id: string): ReleaseRecipient[] =>
      listContacts(db, id).map((c) => ({ contactId: c.id, address: c.value })),
    sendReleaseEmail: async (recipient: string, token: string): Promise<string | null> => {
      const email = buildReleaseEmail(deps.appBaseUrl, token, recipient);
      const result = await notify(registry, {
        channel: "email",
        recipient,
        content: { subject: email.subject, body: email.body, bodyFormat: "text" },
      });
      if (!result.ok || result.outcome.status !== "sent") {
        throw new Error("release email not sent");
      }
      return result.outcome.providerMessageId ?? null;
    },
  };

  // deliverRelease handles the release row, grant minting/hashing, and per-grant email status.
  // It NEVER touches switch state — exactly what a preview needs.
  return deliverRelease(db, release, userId, "manual_test", nowIso);
}
