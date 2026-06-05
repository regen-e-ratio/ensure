import { useEffect } from "react";

/**
 * While `dirty` is true, warn the person (via the browser's native prompt) if they
 * try to leave or reload the page, so unsaved edits are not silently lost (FR-002a).
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy requirement for some browsers to show the native dialog.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
