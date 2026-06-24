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
    // Reload so the page re-renders as a confirmed user — drops the "email
    // unconfirmed" banner from every captain beat (this test isn't about that).
    await page.reload();
    await expect(page.locator(".map-legend")).toBeVisible({ timeout: 15000 });
  },
);

When("I pause the series", async ({ page }) => {
  await page.getByRole("button", { name: "pause series" }).click(); // opens the pause dialog
  const dlg = page.getByRole("alertdialog");
  await dlg.getByLabel("back by").fill("2099-09-01"); // a pause needs a future resume date
  await dlg.getByLabel("why").fill("summer break — back in september");
  await dlg.getByRole("button", { name: "pause series" }).click();
});

Then("the game shows as paused", async ({ page }) => {
  await expect(page.locator(".game-join-box")).toContainText(/paused by the captain/i, { timeout: 10000 });
  await expect(page.locator(".game-paused-note")).toContainText(/summer break/i); // the note shows prominently
  await expect(page.getByRole("button", { name: "resume series" })).toBeVisible();
});

When("I resume the series", async ({ page }) => {
  page.once("dialog", (d) => d.accept()); // simple "resume this series?" confirm
  await page.getByRole("button", { name: "resume series" }).click();
});

Then("the game is running again", async ({ page }) => {
  // Paused notice is gone and the active captain controls (pause/cancel) are back.
  await expect(page.locator(".game-paused")).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByRole("button", { name: "pause series" })).toBeVisible();
});

When("I retire the series", async ({ page }) => {
  await page.getByRole("button", { name: "retire series" }).click(); // opens the type-to-confirm dialog
  const dlg = page.getByRole("alertdialog");
  await dlg.getByLabel("type to confirm").fill("retire this series for good");
  await dlg.getByRole("button", { name: "retire series" }).click();
});

Then("the game shows as retired", async ({ page }) => {
  // Retired series stay on the map; the modal shows the RETIRED badge, drops the
  // captain controls + volunteer block, and becomes a games-played history.
  await expect(page.locator(".game-retired")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".game-captain")).toHaveCount(0);
  await expect(page.getByText(/games played here/i)).toBeVisible();
});

When("I cancel this week", async ({ page, world }) => {
  // Make sure the caption is actually rendered before capturing it — otherwise an
  // empty capture would make the "advanced" assertion below pass vacuously.
  const cap = page.locator(".game-seg-cap");
  await expect(cap).toContainText(/next game/i, { timeout: 10000 });
  world.nextGameCaption = ((await cap.textContent()) ?? "").trim();
  expect(world.nextGameCaption).not.toBe("");
  page.once("dialog", (d) => d.accept()); // simple "call off this week's game?" confirm
  await page.getByRole("button", { name: "cancel this week" }).click();
});

Then("next week becomes the next game", async ({ page, world }) => {
  // The "next game · <date>" caption advances past the called-off week.
  await expect(page.locator(".game-seg-cap")).not.toHaveText(world.nextGameCaption ?? "", { timeout: 10000 });
});

When("I step down as captain", async ({ page }) => {
  page.once("dialog", (d) => d.accept()); // simple "step down as captain?" confirm
  await page.getByRole("button", { name: "step down as captain" }).click();
});

Then("I can volunteer as captain", async ({ page }) => {
  // No longer a captain → the volunteer button is offered, controls are gone.
  await expect(page.getByRole("button", { name: "volunteer as captain" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".game-captain")).not.toContainText(/captain controls/i);
});

Then("the game shows it has no captain", async ({ page }) => {
  await expect(page.locator(".game-captain")).toContainText(/this game has no captain/i, { timeout: 10000 });
});

When("I volunteer as captain", async ({ page }) => {
  await page.getByRole("button", { name: "volunteer as captain" }).click();
});

Then("I have captain controls", async ({ page }) => {
  await expect(page.getByRole("button", { name: "pause series" })).toBeVisible({ timeout: 10000 });
});
