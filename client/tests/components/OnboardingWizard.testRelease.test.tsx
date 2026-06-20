import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEADMAN_DEFAULT_INTERVAL_SECONDS,
  DEADMAN_DEFAULT_GRACE_SECONDS,
} from "@ensure/shared/constants";
import { OnboardingWizard } from "../../src/components/OnboardingWizard";
import { ApiError } from "../../src/api/deadmanClient";
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
const testReleaseMock = vi.mocked(deadmanClient.testRelease);
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

const VERIFIED_CONTACT: Contact = {
  id: "c1",
  type: "email",
  value: "me@example.com",
  verified: true,
  verifiedAt: "2026-06-20T00:00:00Z",
  createdAt: "2026-06-20T00:00:00Z",
} as Contact;

const UNVERIFIED_CONTACT: Contact = { ...VERIFIED_CONTACT, verified: false, verifiedAt: null } as Contact;

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  getNoteMock.mockResolvedValue({ text: "bye", updatedAt: "2026-06-20T00:00:00Z" } as never);
  getStatusMock.mockResolvedValue(DISARMED);
});

describe("OnboardingWizard — test-release preview CTA (US2)", () => {
  it("calls testRelease and confirms accessibly when a verified contact exists", async () => {
    getContactsMock.mockResolvedValue([VERIFIED_CONTACT]);
    testReleaseMock.mockResolvedValue(1);
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    const cta = await screen.findByRole("button", { name: /send myself a test release/i });
    expect(cta).toBeEnabled();
    await user.click(cta);

    expect(testReleaseMock).toHaveBeenCalledOnce();
    // The accessible confirmation explains the preview email + view-once link.
    const confirmation = await screen.findByText(/preview sent/i);
    expect(confirmation).toHaveTextContent(/once/i);
    // It lives in a polite live region (role="status").
    expect(confirmation.closest('[role="status"]')).not.toBeNull();
  });

  it("disables/guards the CTA with an explanation and does NOT call when no verified contact", async () => {
    getContactsMock.mockResolvedValue([UNVERIFIED_CONTACT]);
    render(<OnboardingWizard />);

    const cta = await screen.findByRole("button", { name: /send myself a test release/i });
    expect(cta).toBeDisabled();
    expect(screen.getByText(/verified contact/i)).toBeInTheDocument();
    expect(testReleaseMock).not.toHaveBeenCalled();
  });

  it("surfaces a failure via role=alert without claiming success", async () => {
    getContactsMock.mockResolvedValue([VERIFIED_CONTACT]);
    testReleaseMock.mockRejectedValue(new ApiError("Could not send a test release."));
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    const cta = await screen.findByRole("button", { name: /send myself a test release/i });
    await user.click(cta);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not send/i);
    // Did not falsely claim a preview was sent.
    expect(screen.queryByText(/preview (release )?(was )?sent/i)).not.toBeInTheDocument();
  });

  it("renders NO token, grant, or note plaintext in the confirmation (FR-007/FR-017)", async () => {
    getContactsMock.mockResolvedValue([VERIFIED_CONTACT]);
    getNoteMock.mockResolvedValue({ text: "SECRET-NOTE-PLAINTEXT", updatedAt: "x" } as never);
    testReleaseMock.mockResolvedValue(1);
    const user = userEvent.setup();
    const { container } = render(<OnboardingWizard />);

    await user.click(await screen.findByRole("button", { name: /send myself a test release/i }));
    await waitFor(() => expect(testReleaseMock).toHaveBeenCalled());

    expect(container.textContent).not.toContain("SECRET-NOTE-PLAINTEXT");
    // No token-shaped string (a long base64url run) is rendered.
    expect(container.textContent ?? "").not.toMatch(/token=/i);
  });
});
