import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEADMAN_DEFAULT_INTERVAL_SECONDS,
  DEADMAN_DEFAULT_GRACE_SECONDS,
} from "@ensure/shared/constants";
import { DeadmanDashboard } from "../../src/components/DeadmanDashboard";
import * as deadmanClient from "../../src/api/deadmanClient";
import type { DeadmanStatus } from "../../src/api/deadmanClient";

vi.mock("../../src/api/deadmanClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/deadmanClient")>();
  return { ...actual, getStatus: vi.fn(), putConfig: vi.fn(), checkin: vi.fn() };
});

const getStatusMock = vi.mocked(deadmanClient.getStatus);
const putConfigMock = vi.mocked(deadmanClient.putConfig);
const checkinMock = vi.mocked(deadmanClient.checkin);

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

const ACTIVE: DeadmanStatus = {
  ...DISARMED,
  state: "active",
  enabled: true,
  lastCheckinAt: "2026-06-20T00:00:00.000Z",
  nextCheckinDueAt: "2026-06-27T00:00:00.000Z",
  secondsUntilDue: 604800,
  events: [{ id: "e1", type: "armed", detail: null, createdAt: "2026-06-20T00:00:00.000Z" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("DeadmanDashboard — view + arm + check-in (US1)", () => {
  it("renders the disarmed badge with pre-filled defaults", async () => {
    getStatusMock.mockResolvedValue(DISARMED);
    render(<DeadmanDashboard />);

    expect(await screen.findByTestId("deadman-state")).toHaveTextContent(/disarmed/i);
    expect(screen.getByLabelText(/check-in interval/i)).toHaveValue(
      DEADMAN_DEFAULT_INTERVAL_SECONDS,
    );
    // No countdown while disarmed.
    expect(screen.queryByTestId("deadman-countdown")).not.toBeInTheDocument();
  });

  it("arms with a first-arm confirmation and shows the active badge + countdown", async () => {
    getStatusMock.mockResolvedValue(DISARMED);
    putConfigMock.mockResolvedValue(ACTIVE);
    const user = userEvent.setup();
    render(<DeadmanDashboard />);

    await screen.findByTestId("deadman-state");
    await user.click(screen.getByRole("button", { name: /arm switch/i }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(putConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("deadman-state")).toHaveTextContent(/active/i);
    });
    expect(screen.getByTestId("deadman-countdown")).toBeInTheDocument();
  });

  it("does not arm when the first-arm confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    getStatusMock.mockResolvedValue(DISARMED);
    const user = userEvent.setup();
    render(<DeadmanDashboard />);

    await screen.findByTestId("deadman-state");
    await user.click(screen.getByRole("button", { name: /arm switch/i }));
    expect(putConfigMock).not.toHaveBeenCalled();
  });

  it("checks in via the check-in button and resets the countdown", async () => {
    getStatusMock.mockResolvedValue(ACTIVE);
    checkinMock.mockResolvedValue({
      ...ACTIVE,
      nextCheckinDueAt: "2026-06-28T00:00:00.000Z",
      secondsUntilDue: 604800,
      events: [
        { id: "e2", type: "checkin", detail: null, createdAt: "2026-06-21T00:00:00.000Z" },
        ...ACTIVE.events,
      ],
    });
    const user = userEvent.setup();
    render(<DeadmanDashboard />);

    await screen.findByTestId("deadman-state");
    await user.click(screen.getByRole("button", { name: /i'm alive/i }));

    expect(checkinMock).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByText(/checked in/i)).toBeInTheDocument();
    });
  });
});
