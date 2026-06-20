import type { components } from "@ensure/shared/api";
import { ApiError } from "./noteClient";
import { apiFetch } from "./http";

export type Contact = components["schemas"]["Contact"];
type ContactListResponse = components["schemas"]["ContactListResponse"];
type ContactVerifyResult = components["schemas"]["ContactVerifyResult"];
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

/**
 * Send (or resend) a verification email to one of the caller's own contacts (feature 009).
 * Resolves on success, or throws ApiError with a displayable message (e.g. send failure).
 */
export async function verifyContact(id: string): Promise<void> {
  let res: Response;
  try {
    res = await apiFetch(`${CONTACT_URL}/${encodeURIComponent(id)}/verify`, { method: "POST" });
  } catch {
    throw new ApiError("Could not reach the server. The verification email was not sent.");
  }
  if (!res.ok) {
    throw new ApiError(
      await messageFrom(res, "Could not send the verification email. Please try again."),
    );
  }
}

/**
 * PUBLIC: confirm a verification link by its token (no session). Resolves with the outcome
 * status; only throws ApiError if the server could not be reached (the success/invalid/used
 * outcomes are all carried in the 200 body, per the contract).
 */
export async function confirmVerification(token: string): Promise<ContactVerifyResult["status"]> {
  let res: Response;
  try {
    res = await apiFetch(`${CONTACT_URL}/verify?token=${encodeURIComponent(token)}`);
  } catch {
    throw new ApiError("Could not reach the server. Please try again.");
  }
  if (!res.ok) {
    throw new ApiError("Could not confirm this link. Please try again.");
  }
  const body = (await res.json()) as ContactVerifyResult;
  return body.status;
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
