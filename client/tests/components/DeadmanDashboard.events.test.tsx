import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

const BASE: DeadmanStatus = {
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
});

describe("DeadmanDashboard — recent activity (US3)", () => {
  it("shows the empty state when there are no events", async () => {
    getStatusMock.mockResolvedValue(BASE);
    render(<DeadmanDashboard />);
    expect(await screen.findByText(/no activity yet/i)).toBeInTheDocument();
  });

  it("renders a semantic list of human-readable events newest-first", async () => {
    getStatusMock.mockResolvedValue({
      ...BASE,
      events: [
        { id: "e3", type: "entered_grace", detail: null, createdAt: "2026-06-27T00:00:00.000Z" },
        { id: "e2", type: "checkin", detail: null, createdAt: "2026-06-21T00:00:00.000Z" },
        { id: "e1", type: "armed", detail: null, createdAt: "2026-06-20T00:00:00.000Z" },
      ],
    });
    render(<DeadmanDashboard />);

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/entered grace period/i);
    expect(items[1]).toHaveTextContent(/checked in/i);
    expect(items[2]).toHaveTextContent(/armed/i);
  });
});
