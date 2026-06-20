import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ContactList } from "../../src/components/ContactList";
import * as contactClient from "../../src/api/contactClient";

vi.mock("../../src/api/contactClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/contactClient")>();
  return { ...actual, getContacts: vi.fn(), addContact: vi.fn(), removeContact: vi.fn() };
});

const getContactsMock = vi.mocked(contactClient.getContacts);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ContactList — view (US1)", () => {
  it("shows the empty state when the user has no contacts (FR-002)", async () => {
    getContactsMock.mockResolvedValue([]);
    render(<ContactList />);
    expect(await screen.findByText(/no contacts yet/i)).toBeInTheDocument();
  });

  it("renders a list item per contact", async () => {
    getContactsMock.mockResolvedValue([
      { id: "1", type: "email", value: "alice@example.com", createdAt: "2026-06-07T10:00:00.000Z", verified: false, verifiedAt: null },
      { id: "2", type: "email", value: "Bob@Example.com", createdAt: "2026-06-07T10:01:00.000Z", verified: false, verifiedAt: null },
    ]);
    render(<ContactList />);

    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    });
    // Original case preserved (SC-009).
    expect(screen.getByText("Bob@Example.com")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows an error message when loading fails", async () => {
    getContactsMock.mockRejectedValue(new contactClient.ApiError("Could not load your contacts."));
    render(<ContactList />);
    expect(await screen.findByText(/could not load your contacts/i)).toBeInTheDocument();
  });
});
