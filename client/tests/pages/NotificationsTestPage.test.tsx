import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NotificationsTestPage } from "../../src/pages/NotificationsTestPage";
import * as client from "../../src/api/notificationsClient";

vi.mock("../../src/api/notificationsClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/notificationsClient")>();
  return { ...actual, getChannels: vi.fn(), sendTestNotification: vi.fn() };
});

const getChannelsMock = vi.mocked(client.getChannels);
const sendMock = vi.mocked(client.sendTestNotification);

const CHANNELS: client.ChannelInfo[] = [
  {
    type: "email",
    label: "Email",
    available: true,
    fields: [
      { name: "recipient", label: "Recipient address", type: "email", required: true },
      { name: "subject", label: "Subject", type: "text", required: true },
      { name: "body", label: "Body", type: "textarea", required: true },
      { name: "bodyFormat", label: "Body format", type: "select", required: true, options: ["text", "html"] },
    ],
  },
  { type: "whatsapp", label: "WhatsApp", available: false, fields: [] },
  { type: "push", label: "Push", available: false, fields: [] },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationsTestPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getChannelsMock.mockResolvedValue(CHANNELS);
});

describe("NotificationsTestPage", () => {
  it("renders the Email fields once channels load (FR-012)", async () => {
    renderPage();
    expect(await screen.findByLabelText("Recipient address")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toBeInTheDocument();
    expect(screen.getByLabelText("Body")).toBeInTheDocument();
    expect(screen.getByLabelText("Body format")).toBeInTheDocument();
  });

  it("shows unavailable channels as disabled options (FR-011)", async () => {
    renderPage();
    await screen.findByLabelText("Recipient address");
    const whatsapp = screen.getByRole("option", { name: /whatsapp/i }) as HTMLOptionElement;
    const push = screen.getByRole("option", { name: /push/i }) as HTMLOptionElement;
    expect(whatsapp.disabled).toBe(true);
    expect(push.disabled).toBe(true);
  });

  it("submits the request and announces a success outcome (FR-007)", async () => {
    sendMock.mockResolvedValue({ ok: true, outcome: { status: "sent", channel: "email", providerMessageId: "stub-accepted" } });
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("Recipient address"), "person@example.com");
    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "A test body");
    await user.click(screen.getByRole("button", { name: /send notification/i }));

    expect(sendMock).toHaveBeenCalledWith({
      channel: "email",
      recipient: "person@example.com",
      subject: "Hello",
      body: "A test body",
      bodyFormat: "text",
    });
    expect(await screen.findByText(/sent\./i)).toBeInTheDocument();
  });

  it("shows a server validation-rejection message when the server rejects the request (FR-006)", async () => {
    // The server is the authoritative validator (FR-006). Use inputs that pass the
    // browser's native checks so the request reaches the server, which rejects it.
    sendMock.mockResolvedValue({ ok: false, message: "Body must be at most 10000 characters." });
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("Recipient address"), "person@example.com");
    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "A test body");
    await user.click(screen.getByRole("button", { name: /send notification/i }));

    await waitFor(() => {
      expect(screen.getByText(/at most 10000 characters/i)).toBeInTheDocument();
    });
  });

  it("announces a failed delivery outcome with its reason (FR-008)", async () => {
    sendMock.mockResolvedValue({ ok: true, outcome: { status: "failed", channel: "email", reason: "The email provider did not respond in time." } });
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("Recipient address"), "person@example.com");
    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "A test body");
    await user.click(screen.getByRole("button", { name: /send notification/i }));

    expect(await screen.findByText(/did not respond in time/i)).toBeInTheDocument();
  });
});
