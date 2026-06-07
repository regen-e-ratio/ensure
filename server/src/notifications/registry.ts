import type { ChannelInfo, NotificationChannel, NotificationChannelType } from "./types";
import type { EmailProvider } from "./channels/email/provider";
import { createEmailChannel } from "./channels/email/email-channel";

/**
 * A registry entry: the channel's public descriptor (for `GET /channels`) plus, for
 * available channels, the handler that actually sends. Unavailable channels (WhatsApp,
 * push) are descriptor-only — present so the UI can show the extension point, but with no
 * handler so they cannot send (US3, FR-011).
 */
export interface RegistryEntry {
  info: ChannelInfo;
  channel?: NotificationChannel;
}

/**
 * Build the channel registry. Email is registered as available (its handler wraps the
 * injected provider); WhatsApp and push are registered as unavailable descriptors. Adding
 * a real future channel is a new entry here — no change to {@link notify} or any caller
 * (SC-002, SC-003).
 */
export function buildRegistry(emailProvider: EmailProvider): Map<NotificationChannelType, RegistryEntry> {
  const email = createEmailChannel(emailProvider);

  const registry = new Map<NotificationChannelType, RegistryEntry>();
  registry.set("email", {
    info: { type: "email", label: email.label, available: true, fields: email.fields },
    channel: email,
  });
  registry.set("whatsapp", {
    info: { type: "whatsapp", label: "WhatsApp", available: false, fields: [] },
  });
  registry.set("push", {
    info: { type: "push", label: "Push", available: false, fields: [] },
  });
  return registry;
}

/** The channel descriptors for `GET /notifications/channels`, in registry order. */
export function listChannels(registry: Map<NotificationChannelType, RegistryEntry>): ChannelInfo[] {
  return [...registry.values()].map((entry) => entry.info);
}
