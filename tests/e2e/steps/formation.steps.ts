import { expect, type Page } from "@playwright/test";
import { Given, When, Then } from "./world";
import { E2E } from "../support/env";
import {
  seedFormingAttempt, expireSuggestionWindow, expireAvailabilityWindow,
  commitToTopOption, areaHasGame, getAreaStatus,
} from "../support/db";

// Reuses "I am a confirmed player …" and "I open the game on the map".
const SITE = { lat: 30.281, lng: -97.742, placeText: "Republic Square", city: "Austin", zip: "78701" };

// Drive the real engine the way Vercel Cron does — POST /api/mime/tick with the
// CRON_SECRET bearer (set in playwright.config webServer.env).
async function tick(page: Page) {
  const res = await page.request.post(`${E2E.appBaseUrl}/api/mime/tick`, {
    headers: { authorization: `Bearer ${E2E.cronSecret}` },
  });
  expect(res.ok(), `tick failed: ${res.status()}`).toBeTruthy();
}

Given("a site forming near me", async ({ world }) => {
  const r = await seedFormingAttempt(SITE);
  world.game = { lat: r.lat, lng: r.lng, placeText: r.placeText, areaId: r.areaId };
  world.attemptId = r.attemptId;
});

Then("the proposed site shows", async ({ page }) => {
  await expect(page.locator(".game-card")).toContainText(/proposed game site/i, { timeout: 10000 });
});

When("the suggestion window closes and the engine ticks", async ({ page, world }) => {
  await expireSuggestionWindow(world.attemptId!); // SUGGESTING → AVAILABILITY (compiles options)
  await tick(page);
});

When("enough players commit to a spot", async ({ world }) => {
  await commitToTopOption(world.attemptId!, 6); // p_min
});

When("too few players commit", async ({ world }) => {
  await commitToTopOption(world.attemptId!, 3); // below p_min
});

When("the availability window closes and the engine ticks", async ({ page, world }) => {
  await expireAvailabilityWindow(world.attemptId!); // AVAILABILITY → CONFIRMED or STALLED
  await tick(page);
});

Then("a game is scheduled here", async ({ world }) => {
  expect(await areaHasGame(world.game!.areaId!), "a game should exist for the area").toBe(true);
  expect(await getAreaStatus(world.game!.areaId!)).toBe("SCHEDULED");
});

When("I refresh the map", async ({ page }) => {
  await page.reload(); // drop the stale popup + refetch /api/map so the new game badge shows
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 15000 });
});

Then("the game is on", async ({ page }) => {
  await expect(page.locator(".game-card")).toContainText(/standing game|game on/i, { timeout: 10000 });
});

Then("no game forms and the site stalls", async ({ world }) => {
  expect(await areaHasGame(world.game!.areaId!), "no game should exist").toBe(false);
  expect(await getAreaStatus(world.game!.areaId!)).toBe("STALLED");
});
