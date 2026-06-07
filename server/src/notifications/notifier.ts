import type { NotificationChannelType, NotificationRequest, NotifyResult } from "./types";
import type { RegistryEntry } from "./registry";

/**
 * The single generic notification capability (FR-001, FR-002). Any caller invokes this
 * with `{ channel, recipient, content }`; it looks the channel up in the registry, rejects
 * unknown or disabled channels with a clear "channel not supported" result (FR-009, no
 * handler invoked), and otherwise routes to the channel handler and returns its outcome.
 * Callers contain no channel-specific code.
 */
export async function notify(
  registry: Map<NotificationChannelType, RegistryEntry>,
  request: NotificationRequest,
): Promise<NotifyResult> {
  const entry = registry.get(request.channel);
  if (!entry || !entry.info.available || !entry.channel) {
    return {
      ok: false,
      error: "CHANNEL_NOT_SUPPORTED",
      message: `The '${request.channel}' channel is not available yet.`,
    };
  }

  const result = await entry.channel.send(request);
  if (result.kind === "invalid") {
    return { ok: false, error: "VALIDATION_ERROR", message: result.message };
  }
  return { ok: true, outcome: result.outcome };
}
