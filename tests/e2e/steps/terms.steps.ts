import { expect } from "@playwright/test";
import { Given, Then } from "./world";

Given("I open the terms page", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.locator("main.prose h1")).toHaveText("terms of service");
});

Then("I see the assumption of risk and release of liability", async ({ page }) => {
  // The two sections the waiver hangs on — headings plus the operative language.
  await expect(page.getByRole("heading", { name: "assumption of risk" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "release of liability" })).toBeVisible();
  await expect(page.locator("main.prose")).toContainText("you participate entirely at your own risk");
  await expect(page.locator("main.prose")).toContainText("release and discharge");
  await expect(page.getByRole("heading", { name: "who can use it" })).toBeVisible();
  await expect(page.locator("main.prose")).toContainText("18 or older");
});

Then("the signup form says creating an account accepts the terms", async ({ page }) => {
  const form = page.locator("form.reg-form");
  await expect(form).toContainText("agree to the terms of service");
  await expect(form.locator('a[href="/terms"]')).toBeVisible();
  await expect(form.locator('a[href="/privacy"]').last()).toBeVisible();
});

Then("the footer links to the terms page", async ({ page }) => {
  const link = page.locator('footer.site-footer a[href="/terms"]');
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL("**/terms");
  await expect(page.locator("main.prose h1")).toHaveText("terms of service");
});
