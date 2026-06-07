import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONTACT_LIMIT } from "@ensure/shared/constants";
import { ContactList } from "../../src/components/ContactList";
import * as contactClient from "../../src/api/contactClient";

vi.mock("../../src/api/contactClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/contactClient")>();
  return { ...actual, getContacts: vi.fn(), addContact: vi.fn(), removeContact: vi.fn() };
});

const getContactsMock = vi.mocked(contactClient.getContacts);
const addContactMock = vi.mocked(contactClient.addContact);

beforeEach(() => {
  vi.clearAllMocks();
  getContactsMock.mockResolvedValue([]);
});

describe("ContactList — add (US2)", () => {
  it("adds a valid email via addContact and shows it in the list", async () => {
    addContactMock.mockResolvedValue({
      id: "1",
      type: "email",
      value: "alice@example.com",
      createdAt: "2026-06-07T10:00:00.000Z",
    });
    const user = userEvent.setup();
    render(<ContactList />);

    await screen.findByText(/no contacts yet/i);
    await user.type(screen.getByLabelText(/email address/i), "alice@example.com");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(addContactMock).toHaveBeenCalledWith("alice@example.com");
    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(await screen.findByText(/contact added/i)).toBeInTheDocument();
  });

  it("surfaces the server's error message when the add is rejected (e.g. duplicate, FR-008)", async () => {
    // A well-formed email passes the input's native validation and submits, so the
    // server's rejection message (here a duplicate) is what reaches the user.
    addContactMock.mockRejectedValue(
      new contactClient.ApiError("That contact is already in your list."),
    );
    const user = userEvent.setup();
    render(<ContactList />);

    await screen.findByText(/no contacts yet/i);
    await user.type(screen.getByLabelText(/email address/i), "alice@example.com");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      expect(screen.getByText(/already in your list/i)).toBeInTheDocument();
    });
  });

  it("disables the add control once the contact limit is reached (FR-015)", async () => {
    getContactsMock.mockResolvedValue(
      Array.from({ length: CONTACT_LIMIT }, (_, i) => ({
        id: String(i),
        type: "email" as const,
        value: `user${i}@example.com`,
        createdAt: "2026-06-07T10:00:00.000Z",
      })),
    );
    render(<ContactList />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled();
    });
    expect(screen.getByLabelText(/email address/i)).toBeDisabled();
    expect(screen.getByText(/limit of 50 contacts/i)).toBeInTheDocument();
  });
});
