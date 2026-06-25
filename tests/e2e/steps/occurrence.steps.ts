import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { tickEngine } from "../support/tick";
import { seedWeeklyGameWithClosedPoll, getOccurrenceStatus, expireOccurrenceKickoff } from "../support/db";

// Reuses "I am a confirmed player …" and "I open the game on the map".
const SITE = { lat: 30.281, lng: -97.742, placeText: "Republic Square", city: "Austin", zip: "78701" };

Given("a weekly game whose poll just closed with enough players in", async ({ world }) => {
  const r = await seedWeeklyGameWithClosedPoll({ ...SITE, inCount: 6 }); // min_players_to_schedule
  world.game = { lat: r.lat, lng: r.lng, placeText: r.placeText, gameId: r.gameId, areaId: r.areaId };
  world.occurrenceId = r.occurrenceId;
});

Given("a weekly game whose poll just closed with too few players in", async ({ world }) => {
  const r = await seedWeeklyGameWithClosedPoll({ ...SITE, inCount: 3 }); // below the min
  world.game = { lat: r.lat, lng: r.lng, placeText: r.placeText, gameId: r.gameId, areaId: r.areaId };
  world.occurrenceId = r.occurrenceId;
});

Then("the weekly game shows on the map", async ({ page }) => {
  await expect(page.locator(".game-card")).toContainText(/standing game/i, { timeout: 10000 });
});

When("the engine ticks", async ({ page }) => {
  await tickEngine(page); // tally the closed poll → scheduled (+notify) or skipped
});

Then("the week is on", async ({ world }) => {
  // scheduled → notified → awaiting kickoff, all in one tick.
  expect(await getOccurrenceStatus(world.occurrenceId!)).toBe("awaiting_game");
});

When("game day passes and the engine ticks", async ({ page, world }) => {
  await expireOccurrenceKickoff(world.occurrenceId!);
  await tickEngine(page);
});

Then("the week is played", async ({ world }) => {
  expect(await getOccurrenceStatus(world.occurrenceId!)).toBe("played");
});

Then("the week is skipped", async ({ world }) => {
  expect(await getOccurrenceStatus(world.occurrenceId!)).toBe("skipped");
});
