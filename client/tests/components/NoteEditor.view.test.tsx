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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NoteEditor — view & revise (US2)", () => {
  it("loads and displays the current note with a last-updated time", async () => {
    getNoteMock.mockResolvedValue({
      text: "Existing note",
      createdAt: "2026-06-05T09:00:00.000Z",
      updatedAt: "2026-06-05T10:30:00.000Z",
    });
    render(<NoteEditor />);

    await waitFor(() => {
      expect(screen.getByLabelText(/note/i)).toHaveValue("Existing note");
    });
    expect(screen.getByText(/last updated/i)).toBeInTheDocument();
  });

  it("shows an empty state when there is no saved note (FR-005)", async () => {
    getNoteMock.mockResolvedValue(null);
    render(<NoteEditor />);

    await waitFor(() => {
      expect(screen.getByLabelText(/note/i)).toHaveValue("");
    });
    expect(screen.getByText(/no note saved yet/i)).toBeInTheDocument();
  });

  it("lets the person replace the displayed text", async () => {
    getNoteMock.mockResolvedValue({
      text: "old",
      createdAt: "2026-06-05T09:00:00.000Z",
      updatedAt: "2026-06-05T10:30:00.000Z",
    });
    const user = userEvent.setup();
    render(<NoteEditor />);

    const textarea = await screen.findByDisplayValue("old");
    await user.clear(textarea);
    await user.type(textarea, "new text");
    expect(textarea).toHaveValue("new text");
  });
});
