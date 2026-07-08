import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { waitForEmailTo, clearMailpit, extractButtonLink } from "../support/mailpit";

// Reuses "I am a confirmed player …" (games.steps) to create the account.

Given("I am signed out", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
});

When("I request a password reset for {string}", async ({ page }, email: string) => {
  // Drop the registration email so the only message left is the reset one.
  await clearMailpit();
  await page.goto("/forgot-password");
  await page.locator('input[name="email"], input[autocomplete="email"]').first().fill(email);
  await page.getByRole("button", { name: "send reset link" }).click();
  await expect(page.getByRole("heading", { name: "check your email" })).toBeVisible({ timeout: 10000 });
});

When("I open the reset link and set my password to {string}", async ({ page }, password: string) => {
  const mail = await waitForEmailTo("rita@example.com");
  const link = extractButtonLink(mail.html, "set a new password");
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "set a new password" })).toBeVisible({ timeout: 10000 });
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "set new password" }).click();
  // Lands on the sign-in modal with the "password updated" notice.
  await expect(page.locator(".auth-notice")).toBeVisible({ timeout: 10000 });
});

Then("I can sign in with {string} and {string}", async ({ page }, email: string, password: string) => {
  const card = page.locator(".auth-card");
  await card.locator('input[autocomplete="email"]').fill(email);
  await card.locator('input[autocomplete="current-password"]').fill(password);
  await card.getByRole("button", { name: "log in" }).click();
  await page.waitForURL("**/play", { timeout: 15000 });
  await expect(page.locator(".map-legend")).toBeVisible({ timeout: 15000 });
});

When("I open an invalid reset link", async ({ page }) => {
  await page.goto("/reset-password?token=" + "a".repeat(64));
});

Then("I'm told the reset link is invalid", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /reset link is invalid or expired/i })).toBeVisible();
});
