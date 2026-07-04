import { expect } from "@playwright/test";
import { Given, Then } from "./world";
import { seedGameInMyArea, seedInterestInMyArea, seedOpenProposalInMyArea } from "../support/db";

// Reuses "I am a confirmed player …" and "I open the map" (registered globally
// by other step files).

Given("a standing game is added to my own area", async ({ world }) => {
  await seedGameInMyArea(world.email!, "Republic Square");
});

Given("{int} other neighbors are interested in my own area", async ({ world }, n: number) => {
  await seedInterestInMyArea(world.email!, n);
});

Given("an open proposal with {int} interested is added to my own area", async ({ world }, n: number) => {
  await seedOpenProposalInMyArea(world.email!, "The Park", n);
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

// This area is genuinely isolated (a fresh ZIP nobody else touches), so the
// exact live total (viewer + 3 seeded neighbors = 4) is asserted precisely —
// proving the number is interpolated, not just "some" copy showing up.
Then("the HUD tells me how many are interested near me", async ({ page }) => {
  await expect(page.locator(".map-hud-h")).toContainText(/4 interested in/i, { timeout: 10000 });
  await expect(page.locator(".map-hud-body")).toContainText(/3 others? nearby/i);
});

// Proposer + 1 seeded background user = 2 interested; pMin defaults to 6.
Then("the HUD tells me a game's been proposed with a live tally", async ({ page }) => {
  await expect(page.locator(".map-hud-h")).toContainText(/proposed/i, { timeout: 10000 });
  await expect(page.locator(".map-hud-body")).toContainText(/The Park/);
  await expect(page.locator(".map-hud-body")).toContainText(/2\/6 people are in/i);
});
