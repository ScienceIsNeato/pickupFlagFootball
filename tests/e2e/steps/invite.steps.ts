import { expect } from "@playwright/test";
import { When, Then } from "./world";
import { clearMailpit, waitForEmailTo, extractButtonLink } from "../support/mailpit";

// Reuses "I am a confirmed player …" (games.steps) — lands signed-in on /play,
// where the account-menu avatar is in the header.

When("I invite a friend at {string}", async ({ page }, friendEmail: string) => {
  await clearMailpit(); // so the only mail after is the invite
  await page.locator(".acct-avatar").click();
  await page.getByRole("button", { name: "invite a friend" }).click();
  const modal = page.locator(".auth-card", { hasText: "invite a friend" });
  await modal.locator('input[type=email]').fill(friendEmail);
  await modal.getByRole("button", { name: "send invite" }).click();
  await expect(page.getByRole("heading", { name: "invite sent" })).toBeVisible({ timeout: 10000 });
});

Then("a join-link email reaches {string}", async ({}, friendEmail: string) => {
  const mail = await waitForEmailTo(friendEmail);
  expect(mail.subject.toLowerCase()).toContain("invited you to play");
  // The CTA points at the public registration — no pre-created account.
  const link = extractButtonLink(mail.html, "find a game near you");
  expect(link).toContain("/show-interest");
});
