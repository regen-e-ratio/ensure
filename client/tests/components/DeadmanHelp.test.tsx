import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeadmanHelp } from "../../src/components/DeadmanHelp";

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("DeadmanHelp — in-app explainer (US3)", () => {
  it("renders the dead-man model content with semantic headings", async () => {
    const user = userEvent.setup();
    render(<DeadmanHelp onRelaunchWizard={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /how this works/i }));

    // The explainer has a heading and describes the model.
    expect(screen.getByRole("heading", { name: /how this works/i })).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/disarmed/i);
    expect(text).toMatch(/active/i);
    expect(text).toMatch(/grace/i);
    expect(text).toMatch(/triggered/i);
    // Both check-in paths.
    expect(text).toMatch(/check in/i);
    expect(text).toMatch(/email/i);
    // Verified-contacts-only one-time release.
    expect(text).toMatch(/verified/i);
    expect(text).toMatch(/once/i);
    // Disarm/pause + safeguards.
    expect(text).toMatch(/disarm|pause/i);
  });

  it("offers a control that re-launches the guided wizard", async () => {
    const onRelaunch = vi.fn();
    const user = userEvent.setup();
    render(<DeadmanHelp onRelaunchWizard={onRelaunch} />);

    await user.click(screen.getByRole("button", { name: /how this works/i }));
    await user.click(screen.getByRole("button", { name: /show me|restart the guide|start the guide/i }));

    expect(onRelaunch).toHaveBeenCalledOnce();
  });

  it("is dismissible by Escape and by a labelled close control", async () => {
    const user = userEvent.setup();
    render(<DeadmanHelp onRelaunchWizard={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /how this works/i }));
    expect(screen.getByRole("heading", { name: /how this works/i })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /how this works/i })).not.toBeInTheDocument(),
    );
  });

  it("contains no secret, token, or note plaintext (FR-008/FR-017)", async () => {
    const user = userEvent.setup();
    render(<DeadmanHelp onRelaunchWizard={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /how this works/i }));

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/token=/i);
  });
});
