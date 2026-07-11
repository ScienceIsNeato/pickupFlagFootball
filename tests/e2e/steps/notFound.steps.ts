import { expect } from "@playwright/test";
import { When, Then } from "./world";

When("I open a URL that doesn't exist", async ({ page }) => {
  const res = await page.goto("/no-such-page-anywhere");
  // Next serves the not-found component with a real 404 status.
  expect(res?.status()).toBe(404);
});

Then("I see the branded not-found page with a way home", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /couldn.t find that page/i })).toBeVisible();
  await expect(page.locator("main a.btn-green-link")).toHaveText("back home");
  await expect(page.locator('main a[href="/faq"]')).toBeVisible();
});
