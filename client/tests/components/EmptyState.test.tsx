import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "../../src/components/EmptyState";

describe("EmptyState — informative next-action guidance (US4)", () => {
  it("renders a title and an action hint as accessible text", () => {
    render(<EmptyState title="No activity yet" hint="Arm your switch to start the clock." />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
    expect(screen.getByText(/arm your switch/i)).toBeInTheDocument();
  });

  it("renders the title alone when no hint is given", () => {
    render(<EmptyState title="No contacts yet" />);
    expect(screen.getByText("No contacts yet")).toBeInTheDocument();
  });
});
