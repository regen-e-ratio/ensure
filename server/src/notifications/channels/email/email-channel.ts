import sanitizeHtml from "sanitize-html";
import type { ChannelField, ChannelSendResult, NotificationChannel, NotificationRequest } from "../../types";
import { parseEmailRequest } from "../../validation";
import type { EmailMessage, EmailProvider } from "./provider";

/** Default hard timeout for a provider call (clarified, FR-008). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** The input fields the test page renders for Email (FR-012). */
const EMAIL_FIELDS: ChannelField[] = [
  { name: "recipient", label: "Recipient address", type: "email", required: true },
  { name: "subject", label: "Subject", type: "text", required: true },
  { name: "body", label: "Body", type: "textarea", required: true },
  { name: "bodyFormat", label: "Body format", type: "select", required: true, options: ["text", "html"] },
];

/** Conservative HTML allow-list for sanitization (FR-016): formatting only, no scripts/handlers. */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li",
    "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "span", "div",
  ],
  allowedAttributes: { a: ["href", "title"], span: [], div: [] },
  allowedSchemes: ["http", "https", "mailto"],
  disallowedTagsMode: "discard",
};

type TimeoutResult<T> = { timedOut: false; value: T } | { timedOut: true };

/** Race a promise against a timeout, always clearing the timer. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<TimeoutResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimeoutResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  try {
    return await Promise.race([p.then((value) => ({ timedOut: false as const, value })), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Build the Email channel over an injected {@link EmailProvider}. It validates the
 * Email-specific fields (FR-005, FR-006), sanitizes HTML bodies server-side before they
 * reach the provider (FR-016), bounds the provider call by a hard timeout (FR-008), and
 * maps the provider result to an explicit outcome (FR-007). No recipient/body is logged
 * (FR-014).
 */
export function createEmailChannel(
  provider: EmailProvider,
  options: { timeoutMs?: number } = {},
): NotificationChannel {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    type: "email",
    label: "Email",
    available: true,
    fields: EMAIL_FIELDS,

    async send(request: NotificationRequest): Promise<ChannelSendResult> {
      const parsed = parseEmailRequest(request);
      if (!parsed.ok) {
        return { kind: "invalid", message: parsed.message };
      }
      const { recipient, subject, body, bodyFormat } = parsed.value;

      const message: EmailMessage =
        bodyFormat === "html"
          ? { to: recipient, subject, html: sanitizeHtml(body, SANITIZE_OPTIONS) }
          : { to: recipient, subject, text: body };

      const raced = await withTimeout(provider.send(message), timeoutMs);
      if (raced.timedOut) {
        return {
          kind: "outcome",
          outcome: { status: "failed", channel: "email", reason: "The email provider did not respond in time." },
        };
      }

      const result = raced.value;
      return {
        kind: "outcome",
        outcome: result.accepted
          ? { status: "sent", channel: "email", providerMessageId: result.providerMessageId }
          : {
              status: "failed",
              channel: "email",
              reason: result.reason ?? "The email provider rejected the message.",
            },
      };
    },
  };
}
