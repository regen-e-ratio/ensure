import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CheckedInPage } from "../../src/pages/CheckedInPage";
import * as checkinClient from "../../src/api/checkinClient";

vi.mock("../../src/api/checkinClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/checkinClient")>();
  return { ...actual, checkInWithToken: vi.fn() };
});

const checkInMock = vi.mocked(checkinClient.checkInWithToken);

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <CheckedInPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CheckedInPage (feature 011, public)", () => {
  it("checks in a valid token and announces the confirmation in a live region", async () => {
    checkInMock.mockResolvedValue("checked_in");
    renderPage("/checked-in?token=abc123");

    await waitFor(() => expect(checkInMock).toHaveBeenCalledWith("abc123"));
    const heading = await screen.findByRole("heading", { name: /you're checked in/i });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(/active again/i).closest("[role='status']")).not.toBeNull();
  });

  it("shows a no-longer-available alert for a used/expired/invalid token", async () => {
    checkInMock.mockResolvedValue("not_available");
    renderPage("/checked-in?token=stale");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no longer available/i);
  });

  it("treats a missing token as not-available without calling the server", async () => {
    renderPage("/checked-in");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(checkInMock).not.toHaveBeenCalled();
  });

  it("shows a generic error (not a false confirmation) on a thrown ApiError", async () => {
    checkInMock.mockRejectedValue(new checkinClient.ApiError("Could not reach the server."));
    renderPage("/checked-in?token=abc123");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not check you in/i);
    expect(screen.queryByRole("heading", { name: /you're checked in/i })).toBeNull();
  });

  it("renders a semantic top-level heading reachable without a session", async () => {
    checkInMock.mockResolvedValue("checked_in");
    renderPage("/checked-in?token=abc123");

    expect(
      screen.getByRole("heading", { level: 1, name: /check in to your ensure switch/i }),
    ).toBeInTheDocument();
  });

  it("calls the check-in endpoint only once for a token (StrictMode double-effect guard)", async () => {
    checkInMock.mockResolvedValue("checked_in");
    renderPage("/checked-in?token=abc123");
    await screen.findByRole("heading", { name: /you're checked in/i });
    expect(checkInMock).toHaveBeenCalledTimes(1);
  });
});
