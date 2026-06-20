import type { components } from "@ensure/shared/api";
import { ApiError } from "./noteClient";
import { apiFetch } from "./http";

export type DeadmanStatus = components["schemas"]["DeadmanStatus"];
export type DeadmanConfigInput = components["schemas"]["DeadmanConfigInput"];
export type DeadmanEvent = components["schemas"]["DeadmanEvent"];
type TestReleaseResult = components["schemas"]["TestReleaseResult"];
type ErrorResponse = components["schemas"]["Error"];

export { ApiError };

const DEADMAN_URL = "/api/deadman";

/** Extract a user-displayable message from an error response body, or a fallback. */
async function messageFrom(res: Response, fallback: string): Promise<string> {
  try {
    const err = (await res.json()) as ErrorResponse;
    if (err?.message) return err.message;
  } catch {
    // keep fallback
  }
  return fallback;
}

/** Fetch the caller's switch status (defaults for a never-configured switch). */
export async function getStatus(): Promise<DeadmanStatus> {
  let res: Response;
  try {
    res = await apiFetch(DEADMAN_URL);
  } catch {
    throw new ApiError("Could not reach the server. Please try again.");
  }
  if (!res.ok) {
    throw new ApiError("Could not load your switch. Please try again.");
  }
  return (await res.json()) as DeadmanStatus;
}

/** Configure + arm/disarm the switch. Resolves with the updated status. */
export async function putConfig(input: DeadmanConfigInput): Promise<DeadmanStatus> {
  let res: Response;
  try {
    res = await apiFetch(`${DEADMAN_URL}/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError("Could not reach the server. Your switch was not updated.");
  }
  if (!res.ok) {
    throw new ApiError(await messageFrom(res, "Could not update your switch. Please try again."));
  }
  return (await res.json()) as DeadmanStatus;
}

/** Check in ("I'm alive"). Resolves with the updated status. */
export async function checkin(): Promise<DeadmanStatus> {
  let res: Response;
  try {
    res = await apiFetch(`${DEADMAN_URL}/checkin`, { method: "POST" });
  } catch {
    throw new ApiError("Could not reach the server. Your check-in was not recorded.");
  }
  if (!res.ok) {
    throw new ApiError(await messageFrom(res, "Could not check in. Please try again."));
  }
  return (await res.json()) as DeadmanStatus;
}

/**
 * Send a test release to the caller's own verified contact(s) (feature 010, US3) so they can
 * preview the recipient experience without firing the switch. Resolves with the number of grants
 * created, or throws ApiError with the server's message (e.g. no verified contact). Consumed by
 * feature 012's preview CTA.
 */
export async function testRelease(): Promise<number> {
  let res: Response;
  try {
    res = await apiFetch(`${DEADMAN_URL}/test-release`, { method: "POST" });
  } catch {
    throw new ApiError("Could not reach the server. No test release was sent.");
  }
  if (!res.ok) {
    throw new ApiError(await messageFrom(res, "Could not send a test release. Please try again."));
  }
  const body = (await res.json()) as TestReleaseResult;
  return body.grants;
}
