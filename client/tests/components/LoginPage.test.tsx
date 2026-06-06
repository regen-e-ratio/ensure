import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "../../src/pages/LoginPage";

function renderLogin(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("renders a keyboard-operable 'Sign in with Google' link to the start route, carrying next", () => {
    renderLogin("/login?next=/dashboard");
    const link = screen.getByRole("link", { name: /sign in with google/i });
    // A real <a href> is keyboard reachable/operable by default.
    expect(link).toHaveAttribute("href", "/api/auth/google/start?next=%2Fdashboard");
  });

  it("defaults next to / when none is provided", () => {
    renderLogin("/login");
    const link = screen.getByRole("link", { name: /sign in with google/i });
    expect(link).toHaveAttribute("href", "/api/auth/google/start?next=%2F");
  });

  it("announces a sign-in error via an aria-live region (WCAG AA)", () => {
    renderLogin("/login?error=exchange_failed");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent(/couldn't sign you in/i);
  });

  it("shows a tailored message when the user cancelled", () => {
    renderLogin("/login?error=access_denied");
    expect(screen.getByRole("alert")).toHaveTextContent(/cancelled/i);
  });

  it("shows no error message in the absence of ?error", () => {
    renderLogin("/login");
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });
});
