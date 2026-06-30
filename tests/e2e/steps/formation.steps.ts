import { expect } from "@playwright/test";
import { When, Then } from "./world";
import { tickEngine } from "../support/tick";
import { seedInterested, expireInterestWindow, areaHasGame, getAreaStatus, getAttemptStatus } from "../support/db";

// Shared formation steps for the isolated-proposal model (used by propose.feature).
// Reuses "I am a confirmed player …", "I open the game on the map", "the engine ticks".

Then("the proposed site shows", async ({ page }) => {
  await expect(page.locator(".game-card")).toContainText(/proposed game site/i, { timeout: 10000 });
});

When("enough players are interested", async ({ world }) => {
  await seedInterested(world.attemptId!, 6); // proposer + 6 ≥ p_min
});

When("too few players are interested", async ({ world }) => {
  await seedInterested(world.attemptId!, 3); // proposer + 3 < p_min
});

When("the interest window closes and the engine ticks", async ({ page, world }) => {
  await expireInterestWindow(world.attemptId!); // window past → next tick resolves the proposal
  await tickEngine(page);
});

Then("a game is scheduled here", async ({ world }) => {
  expect(await areaHasGame(world.game!.areaId!), "a game should exist for the area").toBe(true);
  expect(await getAreaStatus(world.game!.areaId!)).toBe("SCHEDULED");
});

When("I refresh the map", async ({ page }) => {
  await page.reload(); // drop the stale popup + refetch /api/map so the new game badge shows
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 15000 });
});

Then("no game forms and the proposal fails", async ({ world }) => {
  expect(await areaHasGame(world.game!.areaId!), "no game should exist").toBe(false);
  expect(await getAttemptStatus(world.attemptId!)).toBe("FAILED");
});
