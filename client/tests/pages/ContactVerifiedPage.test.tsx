import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ContactVerifiedPage } from "../../src/pages/ContactVerifiedPage";
import * as contactClient from "../../src/api/contactClient";

vi.mock("../../src/api/contactClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/contactClient")>();
  return { ...actual, confirmVerification: vi.fn() };
});

const confirmMock = vi.mocked(contactClient.confirmVerification);

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ContactVerifiedPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ContactVerifiedPage (feature 009, public)", () => {
  it("confirms a valid token and announces success", async () => {
    confirmMock.mockResolvedValue("verified");
    renderPage("/contact-verified?token=abc123");

    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith("abc123"));
    const heading = await screen.findByRole("heading", { name: /your email is confirmed/i });
    expect(heading).toBeInTheDocument();
    // Outcome announced in a polite live region.
    expect(screen.getByText(/confirmed control of this email/i).closest("[role='status']")).not.toBeNull();
  });

  it("shows the already-confirmed message", async () => {
    confirmMock.mockResolvedValue("already_verified");
    renderPage("/contact-verified?token=abc123");

    expect(await screen.findByText(/already confirmed/i)).toBeInTheDocument();
  });

  it("announces an invalid/expired/used link as an alert", async () => {
    confirmMock.mockResolvedValue("invalid_or_expired");
    renderPage("/contact-verified?token=stale");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/invalid, has expired, or has already been used/i);
  });

  it("treats a missing token as invalid without calling the server", async () => {
    renderPage("/contact-verified");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("renders a semantic top-level heading reachable without a session", async () => {
    confirmMock.mockResolvedValue("verified");
    renderPage("/contact-verified?token=abc123");

    expect(screen.getByRole("heading", { level: 1, name: /email verification/i })).toBeInTheDocument();
  });
});
