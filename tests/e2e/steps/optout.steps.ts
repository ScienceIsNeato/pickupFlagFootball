import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { seedFormingAttempt, getUserId } from "../support/db";
import { E2E } from "../support/env";
// Relative (not "@/…") so it resolves at runtime under playwright-bdd's loader.
import { signDeclineToken } from "../../../lib/declineLink";

// Reuses "I am a confirmed player …" and "I open the game on the map" — clicking
// the forming badge opens the proposed-site popup (also a .game-card).

Given("a forming game site near me", async ({ world }) => {
  const r = await seedFormingAttempt({
    lat: 30.281, lng: -97.742, placeText: "Republic Square", city: "Austin", zip: "78701",
  });
  world.game = { lat: r.lat, lng: r.lng, placeText: r.placeText, areaId: r.areaId };
});

When("I say I'm not interested in the site", async ({ page }) => {
  await page.getByRole("button", { name: "not interested in this site" }).click();
});

Then("the site shows I opted out", async ({ page }) => {
  await expect(page.locator(".game-optout-note")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: /I.?m interested again/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "not interested in this site" })).toHaveCount(0);
});

When("I say I'm interested again", async ({ page }) => {
  await page.getByRole("button", { name: /I.?m interested again/i }).click();
});

Then("the site offers the not-interested option", async ({ page }) => {
  await expect(page.getByRole("button", { name: "not interested in this site" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".game-optout-note")).toHaveCount(0);
});

When("I open my {string} email link", async ({ page, world }, _label: string) => {
  const userId = await getUserId(world.email!);
  process.env.AUTH_SECRET = E2E.authSecret; // sign with the secret the app verifies under
  const token = signDeclineToken(userId, world.game!.areaId!);
  await page.goto(`/decline?t=${encodeURIComponent(token)}`);
  await expect(page.getByRole("heading", { name: /not interested in this site/i })).toBeVisible({ timeout: 10000 });
});

When("I confirm I'm not interested from the email", async ({ page }) => {
  await page.getByRole("button", { name: /stop emailing me about this site/i }).click();
});

Then("I'm opted out of the site", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /you're out for this site/i })).toBeVisible({ timeout: 10000 });
});
