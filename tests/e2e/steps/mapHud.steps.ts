import { expect } from "@playwright/test";
import { Given, Then } from "./world";
import { seedGameInMyArea } from "../support/db";

// Reuses "I am a confirmed player …" and "I open the map" (registered globally
// by other step files).

Given("a standing game is added to my own area", async ({ world }) => {
  await seedGameInMyArea(world.email!, "Republic Square");
});

Then("the HUD tells me I'm the first one here", async ({ page }) => {
  await expect(page.locator(".map-hud-h")).toContainText(/first one here/i, { timeout: 10000 });
});

Then("the HUD offers a copyable share post", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-write"]);
  const btn = page.locator(".map-hud-copy").first();
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(btn).toContainText(/copied/i);
});

// Loose on the exact count — other scenarios in this shared-DB run may have
// also seeded games in the same fixture area; the HUD's "there's a game" framing
// holds regardless of how many.
Then("the HUD tells me there's a game near me", async ({ page }) => {
  await expect(page.locator(".map-hud-h")).toContainText(/game.*near you|games near you/i, { timeout: 10000 });
});
