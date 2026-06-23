import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { seedCaptain, markEmailVerified } from "../support/db";
import { registerViaUi } from "../support/flows";

// Reuses the "established weekly game near me" Given + "I open the game on the
// map" When from games.steps.ts (steps are registered globally).

Given(
  "I captain it as {string} with email {string} in ZIP {string}",
  async ({ page, world }, name: string, email: string, zip: string) => {
    await registerViaUi(page, world, { name, email, zip });
    await markEmailVerified(email);
    // Captain rights are per-area; the popup reads area_captains live on open.
    await seedCaptain(world.game!.areaId!, email);
    await expect(page.locator(".map-legend")).toBeVisible({ timeout: 15000 });
  },
);

When("I pause the series", async ({ page }) => {
  await page.getByRole("button", { name: "pause series" }).click();
});

Then("the game shows as paused", async ({ page }) => {
  await expect(page.locator(".game-join-box")).toContainText(/paused by the captain/i, { timeout: 10000 });
  await expect(page.getByRole("button", { name: "resume series" })).toBeVisible();
});

When("I resume the series", async ({ page }) => {
  await page.getByRole("button", { name: "resume series" }).click();
});

Then("the game is running again", async ({ page }) => {
  await expect(page.locator(".game-join-box")).toContainText(/join weekly game/i, { timeout: 10000 });
});

When("I retire the series", async ({ page }) => {
  page.once("dialog", (d) => d.accept()); // retire is behind a confirm()
  await page.getByRole("button", { name: "retire series" }).first().click();
});

Then("the game is gone", async ({ page }) => {
  // /api/game only returns active/paused series, so a retired one reads as "no game".
  await expect(page.locator(".game-card")).toContainText(/no game here yet/i, { timeout: 10000 });
});

When("I cancel this week", async ({ page, world }) => {
  // Make sure the caption is actually rendered before capturing it — otherwise an
  // empty capture would make the "advanced" assertion below pass vacuously.
  const cap = page.locator(".game-seg-cap");
  await expect(cap).toContainText(/next game/i, { timeout: 10000 });
  world.nextGameCaption = ((await cap.textContent()) ?? "").trim();
  expect(world.nextGameCaption).not.toBe("");
  await page.getByRole("button", { name: "cancel this week" }).click();
});

Then("next week becomes the next game", async ({ page, world }) => {
  // The "next game · <date>" caption advances past the called-off week.
  await expect(page.locator(".game-seg-cap")).not.toHaveText(world.nextGameCaption ?? "", { timeout: 10000 });
});
