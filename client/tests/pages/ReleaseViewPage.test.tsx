import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ReleaseViewPage } from "../../src/pages/ReleaseViewPage";
import * as releaseClient from "../../src/api/releaseClient";

vi.mock("../../src/api/releaseClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/releaseClient")>();
  return { ...actual, openRelease: vi.fn() };
});

const openMock = vi.mocked(releaseClient.openRelease);

function renderAtToken(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/r/${token}`]}>
      <Routes>
        <Route path="/r/:token" element={<ReleaseViewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReleaseViewPage (feature 010, public view-once)", () => {
  it("renders a prominent single-use warning + the note on success", async () => {
    openMock.mockResolvedValue({ kind: "note", note: "the secret message" });
    renderAtToken("abc123");

    await waitFor(() => expect(openMock).toHaveBeenCalledWith("abc123"));
    expect(await screen.findByText(/the secret message/)).toBeInTheDocument();
    // The "opened once" warning is present (text, not colour-only) inside a polite live region.
    const warning = screen.getByText(/only be opened once/i);
    expect(warning).toBeInTheDocument();
    expect(warning.closest("[role='status']")).not.toBeNull();
  });

  it("calls the open-once client exactly once (StrictMode-safe)", async () => {
    openMock.mockResolvedValue({ kind: "note", note: "x" });
    renderAtToken("abc123");
    await waitFor(() => expect(openMock).toHaveBeenCalled());
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it("shows a clear 'no longer available' message on gone (410/404)", async () => {
    openMock.mockResolvedValue({ kind: "gone" });
    renderAtToken("stale");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no longer available/i);
  });

  it("shows a generic error on failure", async () => {
    openMock.mockRejectedValue(new releaseClient.ApiError("This message could not be opened. Please try again."));
    renderAtToken("boom");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be opened/i);
  });

  it("renders a semantic top-level heading reachable without a session", async () => {
    openMock.mockResolvedValue({ kind: "note", note: "x" });
    renderAtToken("abc123");

    expect(
      screen.getByRole("heading", { level: 1, name: /a message shared with you/i }),
    ).toBeInTheDocument();
  });
});
