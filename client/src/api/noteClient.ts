import type { components } from "@ensure/shared/api";

export type Note = components["schemas"]["Note"];
type NoteResponse = components["schemas"]["NoteResponse"];
type ErrorResponse = components["schemas"]["Error"];

const NOTE_URL = "/api/note";

/** Thrown when the API responds with a non-success status; `message` is user-displayable. */
export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** Fetch the current note, or null when none has been saved yet. */
export async function getNote(): Promise<Note | null> {
  let res: Response;
  try {
    res = await fetch(NOTE_URL);
  } catch {
    throw new ApiError("Could not reach the server. Please try again.");
  }
  if (!res.ok) {
    throw new ApiError("Could not load your note. Please try again.");
  }
  const body = (await res.json()) as NoteResponse;
  return body.note;
}

/** Save the note text. Resolves with the stored note, or throws ApiError with a displayable message. */
export async function putNote(text: string): Promise<Note> {
  let res: Response;
  try {
    res = await fetch(NOTE_URL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    throw new ApiError("Could not reach the server. Your note was not saved.");
  }
  if (!res.ok) {
    let message = "Could not save your note. Please try again.";
    try {
      const err = (await res.json()) as ErrorResponse;
      if (err?.message) message = err.message;
    } catch {
      // keep default message
    }
    throw new ApiError(message);
  }
  const body = (await res.json()) as NoteResponse;
  return body.note as Note;
}
