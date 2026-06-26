import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEADMAN_DEFAULT_INTERVAL_SECONDS,
  DEADMAN_DEFAULT_GRACE_SECONDS,
} from "@ensure/shared/constants";
import { OnboardingWizard } from "../../src/components/OnboardingWizard";
import * as deadmanClient from "../../src/api/deadmanClient";
import * as contactClient from "../../src/api/contactClient";
import * as noteClient from "../../src/api/noteClient";
import type { DeadmanStatus } from "../../src/api/deadmanClient";
import type { Contact } from "../../src/api/contactClient";

vi.mock("../../src/api/deadmanClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/deadmanClient")>();
  return { ...actual, getStatus: vi.fn(), putConfig: vi.fn(), testRelease: vi.fn() };
});
vi.mock("../../src/api/contactClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/contactClient")>();
  return { ...actual, getContacts: vi.fn() };
});
vi.mock("../../src/api/noteClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/noteClient")>();
  return { ...actual, getNote: vi.fn() };
});

const getStatusMock = vi.mocked(deadmanClient.getStatus);
const putConfigMock = vi.mocked(deadmanClient.putConfig);
const getContactsMock = vi.mocked(contactClient.getContacts);
const getNoteMock = vi.mocked(noteClient.getNote);

const DISARMED: DeadmanStatus = {
  state: "disarmed",
  enabled: false,
  checkinIntervalSeconds: DEADMAN_DEFAULT_INTERVAL_SECONDS,
  gracePeriodSeconds: DEADMAN_DEFAULT_GRACE_SECONDS,
  lastCheckinAt: null,
  nextCheckinDueAt: null,
  graceDeadlineAt: null,
  secondsUntilDue: null,
  events: [],
};

const CONTACT: Contact = {
  id: "c1",
  type: "email",
  value: "me@example.com",
  createdAt: "2026-06-20T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  getNoteMock.mockResolvedValue(null);
  getContactsMock.mockResolvedValue([]);
  getStatusMock.mockResolvedValue(DISARMED);
});

describe("OnboardingWizard — step progress + resume (US1)", () => {
  it("starts at the write-note step when nothing is set up", async () => {
    render(<OnboardingWizard />);
    expect(await screen.findByRole("heading", { name: /set up your dead-man switch/i })).toBeInTheDocument();
    // The note step is current (step heading).
    expect(screen.getByRole("heading", { name: /step 1 — write your note/i })).toBeInTheDocument();
  });

  it("resumes at the add-contact step when a note exists but no contact", async () => {
    getNoteMock.mockResolvedValue({ text: "bye", updatedAt: "2026-06-20T00:00:00Z" } as never);
    getContactsMock.mockResolvedValue([]);
    render(<OnboardingWizard />);

    // It skips the completed note step and lands on the contact step (step heading).
    expect(
      await screen.findByRole("heading", { name: /step 2 — add a contact/i }),
    ).toBeInTheDocument();
  });

  it("resumes at the interval/grace step when a contact already exists", async () => {
    getNoteMock.mockResolvedValue({ text: "bye", updatedAt: "2026-06-20T00:00:00Z" } as never);
    getContactsMock.mockResolvedValue([CONTACT]);
    render(<OnboardingWizard />);

    expect(await screen.findByRole("heading", { name: /set up your dead-man switch/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/check-in interval/i)).toBeInTheDocument();
  });

  it("arms via putConfig after an explicit confirm, then moves to completion", async () => {
    getNoteMock.mockResolvedValue({ text: "bye", updatedAt: "2026-06-20T00:00:00Z" } as never);
    getContactsMock.mockResolvedValue([CONTACT]);
    putConfigMock.mockResolvedValue({ ...DISARMED, state: "active", enabled: true });
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    await screen.findByLabelText(/check-in interval/i);
    await user.click(screen.getByRole("button", { name: /arm (my )?switch/i }));

    expect(window.confirm).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(putConfigMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    });
    // Completion state (its heading).
    expect(
      await screen.findByRole("heading", { name: /your switch is set up/i }),
    ).toBeInTheDocument();
  });

  it("does not arm when the confirm is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    getNoteMock.mockResolvedValue({ text: "bye", updatedAt: "2026-06-20T00:00:00Z" } as never);
    getContactsMock.mockResolvedValue([CONTACT]);
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    await screen.findByLabelText(/check-in interval/i);
    await user.click(screen.getByRole("button", { name: /arm (my )?switch/i }));
    expect(putConfigMock).not.toHaveBeenCalled();
  });
});
