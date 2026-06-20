import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEADMAN_DEFAULT_INTERVAL_SECONDS,
  DEADMAN_DEFAULT_GRACE_SECONDS,
} from "@ensure/shared/constants";
import { OnboardingWizard } from "../../src/components/OnboardingWizard";
import { isWizardDismissed } from "../../src/onboarding/firstRun";
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

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  getNoteMock.mockResolvedValue(null);
  getContactsMock.mockResolvedValue([]);
  getStatusMock.mockResolvedValue(DISARMED);
});

describe("OnboardingWizard — dismiss (US1)", () => {
  it("hides on the labelled Dismiss/Skip control and persists for the session", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    await screen.findByRole("heading", { name: /set up your dead-man switch/i });
    await user.click(screen.getByRole("button", { name: /dismiss|skip/i }));

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: /set up your dead-man switch/i }),
      ).not.toBeInTheDocument(),
    );
    // Session-scoped dismissal is recorded (client-local, never a backend call).
    expect(isWizardDismissed()).toBe(true);
    // No backend write happened on dismiss.
    expect(putConfigMock).not.toHaveBeenCalled();
  });

  it("hides on Escape", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    await screen.findByRole("heading", { name: /set up your dead-man switch/i });
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: /set up your dead-man switch/i }),
      ).not.toBeInTheDocument(),
    );
    expect(isWizardDismissed()).toBe(true);
  });

  it("stays hidden after a re-render once dismissed this session", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OnboardingWizard />);

    await screen.findByRole("heading", { name: /set up your dead-man switch/i });
    await user.click(screen.getByRole("button", { name: /dismiss|skip/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: /set up your dead-man switch/i }),
      ).not.toBeInTheDocument(),
    );

    rerender(<OnboardingWizard />);
    await waitFor(() => expect(getStatusMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("heading", { name: /set up your dead-man switch/i }),
    ).not.toBeInTheDocument();
  });
});
