import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteEditor } from "../../src/components/NoteEditor";
import * as noteClient from "../../src/api/noteClient";

vi.mock("../../src/api/noteClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/noteClient")>();
  return { ...actual, getNote: vi.fn(), putNote: vi.fn() };
});

const getNoteMock = vi.mocked(noteClient.getNote);
const putNoteMock = vi.mocked(noteClient.putNote);

beforeEach(() => {
  vi.clearAllMocks();
  getNoteMock.mockResolvedValue(null);
});

describe("NoteEditor — save (US1)", () => {
  it("saves typed text via putNote and shows a success status", async () => {
    putNoteMock.mockResolvedValue({
      text: "Buy milk",
      createdAt: "2026-06-05T10:00:00.000Z",
      updatedAt: "2026-06-05T10:00:00.000Z",
    });
    const user = userEvent.setup();
    render(<NoteEditor />);

    await user.type(screen.getByLabelText(/note/i), "Buy milk");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(putNoteMock).toHaveBeenCalledWith("Buy milk");
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });

  it("shows the error message when the save fails", async () => {
    putNoteMock.mockRejectedValue(new noteClient.ApiError("Note text is required."));
    const user = userEvent.setup();
    render(<NoteEditor />);

    await user.type(screen.getByLabelText(/note/i), "x");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText(/note text is required/i)).toBeInTheDocument();
    });
  });
});
