import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { tickEngine } from "../support/tick";
import { seedWeeklyGameWithClosedPoll, getOccurrenceStatus, expireOccurrenceKickoff, seedRosterMember, setDonationStatus } from "../support/db";
import { allEmails } from "../support/mailpit";
import { openGameOnMap } from "./games.steps";

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

// The "game on this week" email carries the spot, time, headcount, and roster —
// and (for never-decided players) the donation ask, which lives only on this email.
Then("the game-on email lists who's coming", async () => {
  await expect.poll(async () => {
    const won = (await allEmails()).find((e) => /game on this week/i.test(e.subject));
    return won ? /Republic Square/.test(won.html) && /planning to play/i.test(won.html)
      && /Wendy Week/.test(won.html) && /chip in/i.test(won.html) : false;
  }, { timeout: 10000 }).toBe(true);
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

// The upcoming skipped week shows on the card in yellow until its kickoff passes.
Then("the game shows this week skipped for low turnout", async ({ page, world }) => {
  await page.reload(); // the open card is stale; reopen it to reflect the tick
  await openGameOnMap(page, world);
  const banner = page.locator(".game-cancelled--skipped");
  await expect(banner).toBeVisible({ timeout: 10000 });
  await expect(banner).toContainText(/skipped/i);
  await expect(banner).toContainText(/not enough players/i);
});

// A called-off week doesn't beg for money.
Then("the off-week email has no donation ask", async () => {
  await expect.poll(async () => {
    const off = (await allEmails()).find((e) => /no game this week/i.test(e.subject));
    return off ? !/chip in/i.test(off.html) : false;
  }, { timeout: 10000 }).toBe(true);
});

// A supporter on the roster — for the game-on thank-you branch.
Given("I'm a supporter in this game", async ({ world }) => {
  await seedRosterMember(world.game!.gameId!, world.email!, "in");
  await setDonationStatus(world.email!, "subscribed");
});

// Supporters get thanked on the game-on email, never asked.
Then("my game-on email thanks me instead of asking", async ({ world }) => {
  const me = world.email!.toLowerCase();
  await expect.poll(async () => {
    const won = (await allEmails()).find((e) => e.to.toLowerCase() === me && /game on this week/i.test(e.subject));
    return won ? /thank/i.test(won.html) && !/chip in/i.test(won.html) : false;
  }, { timeout: 10000 }).toBe(true);
});
