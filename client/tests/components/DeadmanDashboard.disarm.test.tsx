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

const ACTIVE: DeadmanStatus = {
  state: "active",
  enabled: true,
  checkinIntervalSeconds: DEADMAN_DEFAULT_INTERVAL_SECONDS,
  gracePeriodSeconds: DEADMAN_DEFAULT_GRACE_SECONDS,
  lastCheckinAt: "2026-06-20T00:00:00.000Z",
  nextCheckinDueAt: "2026-06-27T00:00:00.000Z",
  graceDeadlineAt: null,
  secondsUntilDue: 604800,
  events: [{ id: "e1", type: "armed", detail: null, createdAt: "2026-06-20T00:00:00.000Z" }],
};

const DISARMED: DeadmanStatus = {
  ...ACTIVE,
  state: "disarmed",
  enabled: false,
  nextCheckinDueAt: null,
  secondsUntilDue: null,
  events: [
    { id: "e2", type: "disarmed", detail: null, createdAt: "2026-06-21T00:00:00.000Z" },
    ...ACTIVE.events,
  ],
};

const TRIGGERED: DeadmanStatus = {
  ...ACTIVE,
  state: "triggered",
  enabled: true,
  nextCheckinDueAt: null,
  graceDeadlineAt: null,
  secondsUntilDue: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("DeadmanDashboard — disarm (US4)", () => {
  it("disarms and stops the countdown, showing the disarmed badge", async () => {
    getStatusMock.mockResolvedValue(ACTIVE);
    putConfigMock.mockResolvedValue(DISARMED);
    const user = userEvent.setup();
    render(<DeadmanDashboard />);

    await waitFor(() => expect(screen.getByTestId("deadman-state")).toHaveTextContent(/active/i));
    expect(screen.getByTestId("deadman-countdown")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /disarm/i }));
    expect(putConfigMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));

    await waitFor(() =>
      expect(screen.getByTestId("deadman-state")).toHaveTextContent(/disarmed/i),
    );
    expect(screen.queryByTestId("deadman-countdown")).not.toBeInTheDocument();
  });

  it("shows the triggered badge and no check-in button when triggered", async () => {
    getStatusMock.mockResolvedValue(TRIGGERED);
    render(<DeadmanDashboard />);

    expect(await screen.findByTestId("deadman-state")).toHaveTextContent(/triggered/i);
    expect(screen.queryByRole("button", { name: /i'm alive/i })).not.toBeInTheDocument();
    expect(screen.getByText(/already fired/i)).toBeInTheDocument();
  });
});
