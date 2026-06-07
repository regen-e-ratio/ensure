import type { components } from "@ensure/shared/api";
import { apiFetch } from "./http";

export type ChannelInfo = components["schemas"]["ChannelInfo"];
export type ChannelField = components["schemas"]["ChannelField"];
export type SendOutcome = components["schemas"]["SendOutcome"];
export type NotificationTestRequest = components["schemas"]["NotificationTestRequest"];
type ChannelsResponse = components["schemas"]["ChannelsResponse"];
type SendOutcomeResponse = components["schemas"]["SendOutcomeResponse"];
type ErrorResponse = components["schemas"]["Error"];

/** Thrown when a request cannot be completed; `message` is user-displayable. */
export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** Load the available notification channels and their field descriptors. */
export async function getChannels(): Promise<ChannelInfo[]> {
  let res: Response;
  try {
    res = await apiFetch("/api/notifications/channels");
  } catch {
    throw new ApiError("Could not reach the server. Please try again.");
  }
  if (!res.ok) {
    throw new ApiError("Could not load notification channels. Please try again.");
  }
  const body = (await res.json()) as ChannelsResponse;
  return body.channels;
}

/**
 * The outcome of a send attempt: either delivery was attempted (`ok`, carrying the
 * sent/failed outcome) or the request was rejected before delivery (`ok: false`, with a
 * displayable validation/unsupported-channel message).
 */
export type SendResult = { ok: true; outcome: SendOutcome } | { ok: false; message: string };

/** Send a test notification through the generic capability. */
export async function sendTestNotification(input: NotificationTestRequest): Promise<SendResult> {
  let res: Response;
  try {
    res = await apiFetch("/api/notifications/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError("Could not reach the server. The notification was not sent.");
  }
  if (res.ok) {
    const body = (await res.json()) as SendOutcomeResponse;
    return { ok: true, outcome: body.outcome };
  }
  let message = "Could not send the notification. Please try again.";
  try {
    const err = (await res.json()) as ErrorResponse;
    if (err?.message) message = err.message;
  } catch {
    // keep default message
  }
  return { ok: false, message };
}
