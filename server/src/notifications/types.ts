import type { components } from "@ensure/shared/api";

/**
 * Wire shapes reused from the generated OpenAPI types so the server and client share one
 * contract (Principle III). Server-internal types (the dispatcher request, the channel
 * interface, the notify result) are defined here on top of them.
 */
export type NotificationChannelType = components["schemas"]["NotificationChannelType"];
export type ChannelField = components["schemas"]["ChannelField"];
export type ChannelInfo = components["schemas"]["ChannelInfo"];
export type SendOutcome = components["schemas"]["SendOutcome"];
export type NotificationTestRequest = components["schemas"]["NotificationTestRequest"];

/**
 * The uniform request every caller uses (FR-001, FR-002): a channel, a recipient, and
 * channel-specific `content`. The generic dispatcher does not interpret `recipient` or
 * `content`; the matching channel validates and interprets them, so callers stay
 * channel-agnostic.
 */
export interface NotificationRequest {
  channel: NotificationChannelType;
  recipient: string;
  content: unknown;
}

/**
 * A channel's response to a send request: either the input was invalid for this channel
 * (no delivery attempted → the route maps this to 400, FR-006), or delivery was attempted
 * and produced an outcome (sent or failed, FR-007).
 */
export type ChannelSendResult =
  | { kind: "invalid"; message: string }
  | { kind: "outcome"; outcome: SendOutcome };

/** A delivery channel. Only `available` channels carry a working `send` (FR-004, FR-011). */
export interface NotificationChannel {
  readonly type: NotificationChannelType;
  readonly label: string;
  readonly available: boolean;
  readonly fields: ChannelField[];
  send(request: NotificationRequest): Promise<ChannelSendResult>;
}

/**
 * The result of the generic `notify()` capability: either the request was rejected before
 * any delivery (invalid input or an unsupported/disabled channel → 400), or delivery was
 * attempted and an outcome is reported (→ 200). Keeps "we didn't try" distinct from "we
 * tried and here's what happened" (FR-006 vs FR-007/FR-008).
 */
export type NotifyResult =
  | { ok: true; outcome: SendOutcome }
  | { ok: false; error: "VALIDATION_ERROR" | "CHANNEL_NOT_SUPPORTED"; message: string };
