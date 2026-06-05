import { useEffect, useState, type FormEvent } from "react";
import { NOTE_MAX_LENGTH } from "@ensure/shared/constants";
import { ApiError, getNote, putNote } from "../api/noteClient";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";

type Status =
  | { kind: "loading" }
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function NoteEditor() {
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  // Whether the textarea differs from what is stored (drives the unsaved-changes guard).
  const dirty = savedText !== null ? text !== savedText : text.trim().length > 0;
  useUnsavedGuard(dirty);

  // US2: load the current note on mount.
  useEffect(() => {
    let active = true;
    getNote()
      .then((note) => {
        if (!active) return;
        if (note) {
          setText(note.text);
          setSavedText(note.text);
          setUpdatedAt(note.updatedAt);
        }
        setStatus({ kind: "idle" });
      })
      .catch((error) => {
        if (!active) return;
        const message =
          error instanceof ApiError ? error.message : "Could not load your note.";
        setStatus({ kind: "error", message });
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus({ kind: "saving" });
    try {
      const note = await putNote(text);
      setSavedText(note.text);
      setUpdatedAt(note.updatedAt);
      setStatus({ kind: "saved" });
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Could not save your note. Please try again.";
      setStatus({ kind: "error", message });
    }
  }

  const isEmptyState = status.kind !== "loading" && savedText === null;

  const describedBy =
    [isEmptyState ? "note-empty" : null, updatedAt ? "note-updated" : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="note-text">Note</label>
      {isEmptyState ? (
        <p id="note-empty" className="meta">
          No note saved yet. Write your note below and press Save.
        </p>
      ) : null}
      <textarea
        id="note-text"
        value={text}
        maxLength={NOTE_MAX_LENGTH}
        aria-describedby={describedBy}
        onChange={(event) => {
          setText(event.target.value);
          if (status.kind === "saved" || status.kind === "error") {
            setStatus({ kind: "idle" });
          }
        }}
      />
      <button type="submit" disabled={status.kind === "saving" || status.kind === "loading"}>
        {status.kind === "saving" ? "Saving…" : "Save"}
      </button>

      {updatedAt ? (
        <p id="note-updated" className="meta">
          Last updated: {formatTimestamp(updatedAt)}
        </p>
      ) : null}

      {status.kind === "error" ? (
        <p className="status status--error" role="alert">
          {status.message}
        </p>
      ) : (
        <p className="status" role="status" aria-live="polite">
          {status.kind === "saved" ? "Saved." : ""}
        </p>
      )}
    </form>
  );
}
