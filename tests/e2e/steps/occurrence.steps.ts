import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { tickEngine } from "../support/tick";
import { seedWeeklyGameWithClosedPoll, getOccurrenceStatus, expireOccurrenceKickoff, seedRosterMember } from "../support/db";

// Reuses "I am a confirmed player …" and "I open the game on the map".
const SITE = { lat: 30.281, lng: -97.742, placeText: "Republic Square", city: "Austin", zip: "78701" };

// The test user is an actual member of this weekly game — so the story is theirs
// (their poll, their week), not a bystander watching someone else's game.
Given("I'm a regular in this game", async ({ world }) => {
  await seedRosterMember(world.game!.gameId!, world.email!, "in");
});

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

Then("I've found my weekly game", async ({ page }) => {
  const card = page.locator(".game-card");
  await expect(card).toContainText(/standing game/i, { timeout: 10000 });
  // I'm a member — the popup says so, with no "join weekly game" bystander prompt.
  await expect(card).toContainText(/found your weekly game/i);
  await expect(card).not.toContainText(/join weekly game/i);
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
