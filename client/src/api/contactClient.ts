import type { components } from "@ensure/shared/api";
import { ApiError } from "./noteClient";
import { apiFetch } from "./http";

export type Contact = components["schemas"]["Contact"];
type ContactListResponse = components["schemas"]["ContactListResponse"];
type ErrorResponse = components["schemas"]["Error"];

export { ApiError };

const CONTACT_URL = "/api/contact";

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

/** Fetch the caller's contacts (may be empty). */
export async function getContacts(): Promise<Contact[]> {
  let res: Response;
  try {
    res = await apiFetch(CONTACT_URL);
  } catch {
    throw new ApiError("Could not reach the server. Please try again.");
  }
  if (!res.ok) {
    throw new ApiError("Could not load your contacts. Please try again.");
  }
  const body = (await res.json()) as ContactListResponse;
  return body.contacts;
}

/** Add an email contact. Resolves with the stored contact, or throws ApiError with a displayable message. */
export async function addContact(value: string): Promise<Contact> {
  let res: Response;
  try {
    res = await apiFetch(CONTACT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "email", value }),
    });
  } catch {
    throw new ApiError("Could not reach the server. Your contact was not added.");
  }
  if (!res.ok) {
    throw new ApiError(await messageFrom(res, "Could not add the contact. Please try again."));
  }
  return (await res.json()) as Contact;
}

/** Remove a contact by id. Resolves on success, or throws ApiError with a displayable message. */
export async function removeContact(id: string): Promise<void> {
  let res: Response;
  try {
    res = await apiFetch(`${CONTACT_URL}/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    throw new ApiError("Could not reach the server. The contact was not removed.");
  }
  if (!res.ok) {
    throw new ApiError(await messageFrom(res, "Could not remove the contact. Please try again."));
  }
}
