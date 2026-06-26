import { useEffect, useState, type FormEvent } from "react";
import { CONTACT_LIMIT, CONTACT_MAX_LENGTH } from "@ensure/shared/constants";
import {
  ApiError,
  addContact,
  getContacts,
  removeContact,
  type Contact,
} from "../api/contactClient";
import { EmptyState } from "./EmptyState";

type Status =
  | { kind: "loading" }
  | { kind: "idle" }
  | { kind: "adding" }
  | { kind: "added" }
  | { kind: "error"; message: string };

export function ContactList() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [removingId, setRemovingId] = useState<string | null>(null);

  // US1: load the caller's contacts on mount.
  useEffect(() => {
    let active = true;
    getContacts()
      .then((list) => {
        if (!active) return;
        setContacts(list);
        setLoaded(true);
        setStatus({ kind: "idle" });
      })
      .catch((error) => {
        if (!active) return;
        const message =
          error instanceof ApiError ? error.message : "Could not load your contacts.";
        setStatus({ kind: "error", message });
      });
    return () => {
      active = false;
    };
  }, []);

  const atLimit = contacts.length >= CONTACT_LIMIT;

  // US2: add an email contact.
  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setStatus({ kind: "adding" });
    try {
      const contact = await addContact(value);
      setContacts((prev) => [...prev, contact]);
      setValue("");
      setStatus({ kind: "added" });
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Could not add the contact. Please try again.";
      setStatus({ kind: "error", message });
    }
  }

  // US3: remove a contact.
  async function handleRemove(id: string) {
    setRemovingId(id);
    setStatus({ kind: "idle" });
    try {
      await removeContact(id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not remove the contact. Please try again.";
      setStatus({ kind: "error", message });
    } finally {
      setRemovingId(null);
    }
  }

  const isEmptyState = loaded && contacts.length === 0;

  return (
    <section aria-labelledby="contacts-heading">
      <h2 id="contacts-heading">Contacts</h2>

      {status.kind === "loading" ? (
        <p role="status" aria-live="polite">
          Loading…
        </p>
      ) : null}

      {isEmptyState ? (
        <EmptyState
          id="contacts-empty"
          title="No contacts yet"
          hint="Add an email address below — your contacts receive your note if your switch ever fires."
        />
      ) : null}

      {contacts.length > 0 ? (
        <ul className="contact-list">
          {contacts.map((contact) => (
            <li key={contact.id} className="contact-list__item">
              <span className="contact-list__value">{contact.value}</span>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void handleRemove(contact.id)}
                disabled={removingId === contact.id}
                aria-label={`Remove ${contact.value}`}
              >
                {removingId === contact.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={handleAdd}>
        <label htmlFor="contact-email">Email address</label>
        <input
          id="contact-email"
          type="email"
          value={value}
          maxLength={CONTACT_MAX_LENGTH}
          autoComplete="email"
          aria-describedby={atLimit ? "contacts-limit" : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            if (status.kind === "added" || status.kind === "error") {
              setStatus({ kind: "idle" });
            }
          }}
          disabled={atLimit || status.kind === "loading"}
        />
        <button
          type="submit"
          disabled={atLimit || status.kind === "adding" || status.kind === "loading"}
        >
          {status.kind === "adding" ? "Adding…" : "Add"}
        </button>

        {atLimit ? (
          <p id="contacts-limit" className="meta">
            You have reached the limit of {CONTACT_LIMIT} contacts.
          </p>
        ) : null}

        {status.kind === "error" ? (
          <p className="status status--error" role="alert">
            {status.message}
          </p>
        ) : (
          <p className="status" role="status" aria-live="polite">
            {status.kind === "added" ? "Contact added." : ""}
          </p>
        )}
      </form>
    </section>
  );
}
