import type { components } from "@ensure/shared/api";
import { ApiError } from "./noteClient";
import { apiFetch } from "./http";

type CheckinLinkResult = components["schemas"]["CheckinLinkResult"];

export { ApiError };

const CHECKIN_URL = "/api/deadman/checkin";

/**
 * PUBLIC: check in from a one-time email link by its token (no session, feature 011). Maps the
 * public `GET /api/deadman/checkin?token=…` to its `{ status }` outcome — `checked_in` (the clock
 * was reset) or `not_available` (used/expired/invalid token, or a non-checkable switch), both
 * carried in the 200 body per the contract. Only throws {@link ApiError} when the server could not
 * be reached or returned an unexpected status. The public route needs no silent-refresh — apiFetch
 * passes it through when there is no session.
 */
export async function checkInWithToken(token: string): Promise<CheckinLinkResult["status"]> {
  let res: Response;
  try {
    res = await apiFetch(`${CHECKIN_URL}?token=${encodeURIComponent(token)}`);
  } catch {
    throw new ApiError("Could not reach the server. Please try again.");
  }
  if (!res.ok) {
    throw new ApiError("Could not check you in. Please try again.");
  }
  const body = (await res.json()) as CheckinLinkResult;
  return body.status;
}
