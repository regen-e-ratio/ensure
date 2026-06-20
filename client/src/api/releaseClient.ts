import type { components } from "@ensure/shared/api";
import { ApiError } from "./noteClient";
import { apiFetch } from "./http";

type ReleaseView = components["schemas"]["ReleaseView"];

export { ApiError };

const RELEASE_URL = "/api/release";

/** The outcome of opening a one-time release link. */
export type OpenReleaseResult =
  | { kind: "note"; note: string }
  | { kind: "gone" };

/**
 * Open a one-time release link (feature 010, public view-once page). Maps the public
 * `GET /api/release/{token}` to a small union: `200` → the decrypted note (returned once),
 * `410` → gone (already viewed or expired), `404` → gone (not available; non-disclosing), and
 * any other status (incl. a `500` decrypt failure) → a thrown {@link ApiError} the page shows
 * as a generic error. The public route needs no silent-refresh — `apiFetch` simply passes it
 * through when there is no session.
 */
export async function openRelease(token: string): Promise<OpenReleaseResult> {
  let res: Response;
  try {
    res = await apiFetch(`${RELEASE_URL}/${encodeURIComponent(token)}`);
  } catch {
    throw new ApiError("Could not reach the server. Please try again.");
  }

  if (res.ok) {
    const body = (await res.json()) as ReleaseView;
    return { kind: "note", note: body.note };
  }
  if (res.status === 410 || res.status === 404) {
    return { kind: "gone" };
  }
  throw new ApiError("This message could not be opened. Please try again.");
}
