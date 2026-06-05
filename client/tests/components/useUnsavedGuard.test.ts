import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUnsavedGuard } from "../../src/hooks/useUnsavedGuard";

function fireBeforeUnload(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("useUnsavedGuard", () => {
  it("does NOT block navigation when there are no unsaved changes", () => {
    renderHook(({ dirty }) => useUnsavedGuard(dirty), { initialProps: { dirty: false } });
    expect(fireBeforeUnload()).toBe(false);
  });

  it("blocks navigation while there are unsaved changes (FR-002a)", () => {
    renderHook(({ dirty }) => useUnsavedGuard(dirty), { initialProps: { dirty: true } });
    expect(fireBeforeUnload()).toBe(true);
  });

  it("stops blocking once changes are saved (dirty -> false)", () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedGuard(dirty), {
      initialProps: { dirty: true },
    });
    expect(fireBeforeUnload()).toBe(true);
    rerender({ dirty: false });
    expect(fireBeforeUnload()).toBe(false);
  });
});
