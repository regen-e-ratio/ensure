import type { Db } from "../db/index";
import type { EmailProvider } from "../notifications/channels/email/provider";
import { buildRegistry } from "../notifications/registry";
import { notify } from "../notifications/notifier";
import { getUser } from "../db/user-repo";
import type { Deps, ReminderMessage } from "./engine";

/**
 * Build the engine's injected {@link Deps} from the real collaborators: a notifier closure
 * over the generic `notify(buildRegistry(emailProvider), …)` dispatcher (never a provider
 * directly), a `Date` clock, and a `userEmailFor` resolver reading the user's account
 * email. Shared by the boot path (`server.ts`) and the `deadman:tick` CLI so both drive the
 * engine identically. Email body/subject carry no secrets (FR-017).
 */
export function buildDeadmanDeps(db: Db, emailProvider: EmailProvider): Deps {
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
  };
}
