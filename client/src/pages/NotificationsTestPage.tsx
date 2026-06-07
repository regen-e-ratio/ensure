import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  getChannels,
  sendTestNotification,
  type ChannelInfo,
  type ChannelField,
  type NotificationTestRequest,
  type SendOutcome,
} from "../api/notificationsClient";

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "sending" }
  | { kind: "outcome"; outcome: SendOutcome }
  | { kind: "rejected"; message: string }
  | { kind: "error"; message: string };

/** Initial field values for a channel (selects default to their first option). */
function defaultsFor(channel: ChannelInfo): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of channel.fields) {
    values[field.name] = field.type === "select" ? (field.options?.[0] ?? "") : "";
  }
  return values;
}

/** Build the typed request from the current field values for the selected channel. */
function toRequest(type: ChannelInfo["type"], values: Record<string, string>): NotificationTestRequest {
  return {
    channel: type,
    recipient: values.recipient,
    subject: values.subject,
    body: values.body,
    bodyFormat: values.bodyFormat === "html" ? "html" : "text",
  };
}

export function NotificationsTestPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    getChannels()
      .then((list) => {
        if (!active) return;
        setChannels(list);
        const first = list.find((channel) => channel.available) ?? list[0];
        if (first) {
          setSelected(first.type);
          setValues(defaultsFor(first));
        }
        setStatus({ kind: "ready" });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setStatus({
          kind: "error",
          message: err instanceof ApiError ? err.message : "Could not load notification channels.",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  const current = useMemo(
    () => channels.find((channel) => channel.type === selected),
    [channels, selected],
  );

  function onSelectChannel(type: string) {
    setSelected(type);
    const channel = channels.find((c) => c.type === type);
    setValues(channel ? defaultsFor(channel) : {});
    if (status.kind !== "loading") setStatus({ kind: "ready" });
  }

  function setField(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
    if (status.kind === "outcome" || status.kind === "rejected" || status.kind === "error") {
      setStatus({ kind: "ready" });
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!current || !current.available) return;
    setStatus({ kind: "sending" });
    try {
      const result = await sendTestNotification(toRequest(current.type, values));
      setStatus(result.ok ? { kind: "outcome", outcome: result.outcome } : { kind: "rejected", message: result.message });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof ApiError ? err.message : "Could not send the notification.",
      });
    }
  }

  const canSend = current?.available === true && status.kind !== "sending";

  return (
    <main>
      <header className="app-header">
        <h1>Notification test page</h1>
        <Link className="button button--ghost" to="/">
          Back to note
        </Link>
      </header>

      <p className="meta">
        Send a notification through the generic system. In this version only Email is enabled and it
        runs against a no-network stub provider, so no real email is delivered yet.
      </p>

      {status.kind === "loading" ? (
        <p className="status" role="status" aria-live="polite">
          Loading channels…
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <label htmlFor="channel">Channel</label>
          <select
            id="channel"
            value={selected}
            onChange={(event) => onSelectChannel(event.target.value)}
          >
            {channels.map((channel) => (
              <option key={channel.type} value={channel.type} disabled={!channel.available}>
                {channel.label}
                {channel.available ? "" : " (coming soon)"}
              </option>
            ))}
          </select>

          {current?.fields.map((field) => (
            <FieldControl
              key={field.name}
              field={field}
              value={values[field.name] ?? ""}
              onChange={(value) => setField(field.name, value)}
            />
          ))}

          <button type="submit" disabled={!canSend}>
            {status.kind === "sending" ? "Sending…" : "Send notification"}
          </button>

          <OutcomeRegion status={status} />
        </form>
      )}
    </main>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: ChannelField;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `field-${field.name}`;
  return (
    <>
      <label htmlFor={id}>{field.label}</label>
      {field.type === "textarea" ? (
        <textarea id={id} value={value} required={field.required} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "select" ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.type === "email" ? "email" : "text"}
          value={value}
          required={field.required}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </>
  );
}

/** Accessible, announced result of the last send (FR-007, FR-015). */
function OutcomeRegion({ status }: { status: Status }) {
  if (status.kind === "outcome") {
    if (status.outcome.status === "sent") {
      return (
        <p className="status" role="status" aria-live="polite">
          Sent. The notification was accepted by the provider.
        </p>
      );
    }
    return (
      <p className="status status--error" role="alert">
        Failed: {status.outcome.reason ?? "The notification could not be delivered."}
      </p>
    );
  }
  if (status.kind === "rejected" || status.kind === "error") {
    return (
      <p className="status status--error" role="alert">
        {status.message}
      </p>
    );
  }
  return (
    <p className="status" role="status" aria-live="polite">
      {status.kind === "sending" ? "Sending…" : ""}
    </p>
  );
}
