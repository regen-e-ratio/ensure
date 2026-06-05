import { test, expect } from "@playwright/test";

// US2 acceptance scenarios. Runs serially (see playwright.config.ts) starting from an empty store.

test.describe.serial("view & revise the note", () => {
  test.beforeEach(async ({ request }) => {
    await request.post("/api/test/reset");
  });

  test("shows an empty state on first visit (FR-005)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/no note saved yet/i)).toBeVisible();
    await expect(page.getByLabel(/note/i)).toHaveValue("");
  });

  test("editing an existing note replaces it after reload (FR-006)", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel(/note/i).fill("first version");
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByText(/saved/i)).toBeVisible();

    await page.getByLabel(/note/i).fill("second version");
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByText(/saved/i)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/note/i)).toHaveValue("second version");
    await expect(page.getByText(/last updated/i)).toBeVisible();
  });

  test("warns when leaving with unsaved changes (FR-002a)", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel(/note/i).fill("an unsaved edit");

    let dialogSeen = false;
    page.on("dialog", (dialog) => {
      dialogSeen = true;
      void dialog.dismiss();
    });
    // Triggering a navigation with a dirty form fires the beforeunload handler.
    await page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      // Expose whether the app prevented the unload.
      (window as unknown as { __prevented: boolean }).__prevented = e.defaultPrevented;
    });
    const prevented = await page.evaluate(
      () => (window as unknown as { __prevented: boolean }).__prevented,
    );
    expect(prevented).toBe(true);
    expect(dialogSeen || prevented).toBe(true);
  });
});
