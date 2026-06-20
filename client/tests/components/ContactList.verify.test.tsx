import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactList } from "../../src/components/ContactList";
import * as contactClient from "../../src/api/contactClient";

vi.mock("../../src/api/contactClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/contactClient")>();
  return {
    ...actual,
    getContacts: vi.fn(),
    addContact: vi.fn(),
    removeContact: vi.fn(),
    verifyContact: vi.fn(),
  };
});

const getContactsMock = vi.mocked(contactClient.getContacts);
const verifyContactMock = vi.mocked(contactClient.verifyContact);

function contact(over: Partial<contactClient.Contact> = {}): contactClient.Contact {
  return {
    id: "1",
    type: "email",
    value: "alice@example.com",
    createdAt: "2026-06-07T10:00:00.000Z",
    verified: false,
    verifiedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ContactList — verification (feature 009, US2)", () => {
  it("shows a text-labelled badge per contact (verified vs not verified, not colour-only)", async () => {
    getContactsMock.mockResolvedValue([
      contact({ id: "1", value: "unv@example.com" }),
      contact({ id: "2", value: "ver@example.com", verified: true, verifiedAt: "2026-06-08T00:00:00.000Z" }),
    ]);
    render(<ContactList />);

    expect(await screen.findByText("Not verified")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("offers 'Send verification' for an unverified contact and 'Resend' for a verified one", async () => {
    getContactsMock.mockResolvedValue([
      contact({ id: "1", value: "unv@example.com" }),
      contact({ id: "2", value: "ver@example.com", verified: true, verifiedAt: "2026-06-08T00:00:00.000Z" }),
    ]);
    render(<ContactList />);

    expect(
      await screen.findByRole("button", { name: /send verification to unv@example.com/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resend verification to ver@example.com/i }),
    ).toBeInTheDocument();
  });

  it("sends a verification email and announces a polite status", async () => {
    getContactsMock.mockResolvedValue([contact({ id: "1", value: "alice@example.com" })]);
    verifyContactMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ContactList />);

    await user.click(
      await screen.findByRole("button", { name: /send verification to alice@example.com/i }),
    );

    expect(verifyContactMock).toHaveBeenCalledWith("1");
    const status = await screen.findByText(/verification email sent/i);
    expect(status).toBeInTheDocument();
    expect(status.closest("[role='status']")).not.toBeNull();
  });

  it("announces an assertive error when the send fails", async () => {
    getContactsMock.mockResolvedValue([contact({ id: "1", value: "alice@example.com" })]);
    verifyContactMock.mockRejectedValue(
      new contactClient.ApiError("Could not send the verification email. Please try again."),
    );
    const user = userEvent.setup();
    render(<ContactList />);

    await user.click(
      await screen.findByRole("button", { name: /send verification to alice@example.com/i }),
    );

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(/could not send the verification email/i);
    });
  });
});
