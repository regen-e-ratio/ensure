import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactList } from "../../src/components/ContactList";
import * as contactClient from "../../src/api/contactClient";

vi.mock("../../src/api/contactClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/contactClient")>();
  return { ...actual, getContacts: vi.fn(), addContact: vi.fn(), removeContact: vi.fn() };
});

const getContactsMock = vi.mocked(contactClient.getContacts);
const removeContactMock = vi.mocked(contactClient.removeContact);

beforeEach(() => {
  vi.clearAllMocks();
  getContactsMock.mockResolvedValue([
    { id: "1", type: "email", value: "alice@example.com", createdAt: "2026-06-07T10:00:00.000Z" },
  ]);
});

describe("ContactList — remove (US3)", () => {
  it("removes a contact via removeContact and drops it from the list", async () => {
    removeContactMock.mockResolvedValue();
    const user = userEvent.setup();
    render(<ContactList />);

    await screen.findByText("alice@example.com");
    await user.click(screen.getByRole("button", { name: /remove alice@example.com/i }));

    expect(removeContactMock).toHaveBeenCalledWith("1");
    await waitFor(() => {
      expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no contacts yet/i)).toBeInTheDocument();
  });

  it("shows an error and keeps the contact when removal fails", async () => {
    removeContactMock.mockRejectedValue(
      new contactClient.ApiError("Could not remove the contact. Please try again."),
    );
    const user = userEvent.setup();
    render(<ContactList />);

    await screen.findByText("alice@example.com");
    await user.click(screen.getByRole("button", { name: /remove alice@example.com/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not remove the contact/i)).toBeInTheDocument();
    });
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });
});
