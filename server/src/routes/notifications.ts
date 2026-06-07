import { Router } from "express";
import { z } from "zod";
import type { EmailProvider } from "../notifications/channels/email/provider";
import { buildRegistry, listChannels } from "../notifications/registry";
import { notify } from "../notifications/notifier";

/**
 * Router for the generic notification capability and its test page, mounted at
 * /api/notifications behind `requireAuth` (FR-013):
 *   - GET  /channels — channel availability + per-channel fields (drives the dynamic form)
 *   - POST /test     — send through the same generic `notify()` any caller uses
 *
 * Status mapping (research.md D6): invalid input → 400 VALIDATION_ERROR (no delivery);
 * known-but-disabled channel → 400 CHANNEL_NOT_SUPPORTED; delivery attempted → 200 with the
 * outcome (sent or failed). The email provider is injected, so the vendor is swappable.
 */
export function createNotificationsRouter(emailProvider: EmailProvider): Router {
  const registry = buildRegistry(emailProvider);
  const router = Router();

  router.get("/channels", (_req, res) => {
    res.status(200).json({ channels: listChannels(registry) });
  });

  const bodySchema = z.object({
    channel: z.enum(["email", "whatsapp", "push"], {
      errorMap: () => ({ message: "Unknown notification channel." }),
    }),
    recipient: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    bodyFormat: z.string().optional(),
  });

  router.post("/test", async (req, res) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "The request is invalid.",
      });
      return;
    }

    const { channel, recipient, subject, body, bodyFormat } = parsed.data;
    const result = await notify(registry, {
      channel,
      recipient: recipient ?? "",
      content: { subject, body, bodyFormat },
    });

    if (!result.ok) {
      res.status(400).json({ error: result.error, message: result.message });
      return;
    }
    res.status(200).json({ outcome: result.outcome });
  });

  return router;
}
