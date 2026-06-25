import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { seedFormingSite } from "../support/db";

// Reuses "I am a confirmed player …" and "I open the game on the map" — clicking
// the forming badge opens the proposed-site popup (also a .game-card).

Given("a forming game site near me", async ({ world }) => {
  world.game = await seedFormingSite({
    lat: 30.281, lng: -97.742, placeText: "Republic Square", city: "Austin", zip: "78701",
  });
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
