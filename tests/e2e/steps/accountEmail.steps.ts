import { expect } from "@playwright/test";
import { When, Then } from "./world";
import { clearMailpit, waitForEmailTo, extractConfirmLink } from "../support/mailpit";

// Reuses "I am a confirmed player …" (games.steps) to create the account.

When("I change my email to {string}", async ({ page, world }, newEmail: string) => {
  await clearMailpit(); // so the only mail after is the change confirmation
  await page.goto("/account");
  await page.getByRole("button", { name: "change email" }).click();
  await page.locator(".acct-email-form input[type=email]").fill(newEmail);
  await page.getByRole("button", { name: "update email" }).click();
  await expect(page.getByText(/we sent a confirmation to/i)).toBeVisible({ timeout: 10000 });
  world.email = newEmail; // downstream steps confirm the NEW address
});

Then("a confirmation is sent to {string}", async ({ world }, newEmail: string) => {
  const mail = await waitForEmailTo(newEmail);
  world.confirmLink = extractConfirmLink(mail.html);
  expect(world.confirmLink).toContain("/verify-email?token=");
});

Then("confirming that link verifies the new address", async ({ page, world }) => {
  await page.goto(world.confirmLink!);
  await page.getByRole("button", { name: "confirm my email" }).click();
  await expect(page.getByRole("heading", { name: /email confirmed/i })).toBeVisible({ timeout: 15000 });
});
