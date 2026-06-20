import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  DEADMAN_DEFAULT_INTERVAL_SECONDS,
  DEADMAN_DEFAULT_GRACE_SECONDS,
} from "@ensure/shared/constants";
import { OnboardingWizard } from "../../src/components/OnboardingWizard";
import * as deadmanClient from "../../src/api/deadmanClient";
import * as contactClient from "../../src/api/contactClient";
import * as noteClient from "../../src/api/noteClient";
import type { DeadmanStatus } from "../../src/api/deadmanClient";

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

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  getNoteMock.mockResolvedValue(null);
  getContactsMock.mockResolvedValue([]);
});

describe("OnboardingWizard — first-run offer (US1)", () => {
  it("is offered when the switch is disarmed with no prior arm", async () => {
    getStatusMock.mockResolvedValue(DISARMED);
    render(<OnboardingWizard />);

    expect(await screen.findByRole("heading", { name: /set up your dead-man switch/i })).toBeInTheDocument();
    // The first step (write a note) is shown.
    expect(screen.getByRole("button", { name: /dismiss|skip/i })).toBeInTheDocument();
  });

  it("is NOT auto-offered when an `armed` event exists (ever-armed)", async () => {
    getStatusMock.mockResolvedValue({
      ...DISARMED,
      events: [{ id: "e1", type: "armed", detail: null, createdAt: "2026-06-20T00:00:00Z" }],
    });
    render(<OnboardingWizard />);

    // Give the async reads a chance to settle, then assert it stayed hidden.
    await waitFor(() => expect(getStatusMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("heading", { name: /set up your dead-man switch/i }),
    ).not.toBeInTheDocument();
  });

  it("is NOT auto-offered when lastCheckinAt is set (a prior arm)", async () => {
    getStatusMock.mockResolvedValue({ ...DISARMED, lastCheckinAt: "2026-06-20T00:00:00Z" });
    render(<OnboardingWizard />);

    await waitFor(() => expect(getStatusMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("heading", { name: /set up your dead-man switch/i }),
    ).not.toBeInTheDocument();
  });

  it("is NOT auto-offered when the switch is active", async () => {
    getStatusMock.mockResolvedValue({ ...DISARMED, state: "active", enabled: true });
    render(<OnboardingWizard />);

    await waitFor(() => expect(getStatusMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("heading", { name: /set up your dead-man switch/i }),
    ).not.toBeInTheDocument();
  });
});
