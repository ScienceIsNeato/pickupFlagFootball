import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { seedFormingAttempt, getUserId } from "../support/db";
import { E2E } from "../support/env";
// Relative (not "@/…") so it resolves at runtime under playwright-bdd's loader.
import { signInterestToken } from "../../../lib/interestLink";

// Reuses "I am a confirmed player …" and "I open the game on the map" — clicking
// the forming badge opens the proposed-site popup (also a .game-card).

Given("a forming game site near me", async ({ world }) => {
  const r = await seedFormingAttempt({
    lat: 30.281, lng: -97.742, placeText: "Republic Square", city: "Austin", zip: "78701",
  });
  world.game = { lat: r.lat, lng: r.lng, placeText: r.placeText, areaId: r.areaId };
  world.attemptId = r.attemptId;
});

When("I say I'm not interested", async ({ page }) => {
  await page.getByRole("button", { name: "not interested" }).click();
});

Then("the proposal shows I'm out", async ({ page }) => {
  await expect(page.getByRole("button", { name: "not interested" }))
    .toHaveAttribute("aria-pressed", "true", { timeout: 10000 });
});

When("I say I'm interested after all", async ({ page }) => {
  await page.getByRole("button", { name: /i.?m interested/i }).click();
});

Then("the proposal shows I'm in", async ({ page }) => {
  await expect(page.locator(".game-card")).toContainText(/you're in/i, { timeout: 10000 });
  await expect(page.getByRole("button", { name: /i.?m interested/i }))
    .toHaveAttribute("aria-pressed", "true");
});

When("I open my not-interested email link", async ({ page, world }) => {
  const userId = await getUserId(world.email!);
  process.env.AUTH_SECRET = E2E.authSecret; // sign with the secret the app verifies under
  const token = signInterestToken(userId, world.attemptId!, "out");
  await page.goto(`/interested?t=${encodeURIComponent(token)}`);
  await expect(page.getByRole("heading", { name: /not this one/i })).toBeVisible({ timeout: 10000 });
});

When("I confirm not interested from the email", async ({ page }) => {
  await page.getByRole("button", { name: "confirm" }).click();
});

Then("I'm marked not interested", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /no worries/i })).toBeVisible({ timeout: 10000 });
});
