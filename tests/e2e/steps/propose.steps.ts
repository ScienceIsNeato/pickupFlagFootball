import { expect } from "@playwright/test";
import { When, Then } from "./world";
import { proposeAsUser, isAreaCaptain } from "../support/db";
import { allEmails } from "../support/mailpit";

// Reuses "I am a confirmed player …", "I open the game on the map", "the engine
// ticks", and the shared formation steps (interest window, schedule/fail).
const SITE = { lat: 30.281, lng: -97.742, placeText: "Republic Square", city: "Austin", zip: "78701" };

When("I propose a game at a nearby spot", async ({ world }) => {
  const r = await proposeAsUser(world.email!, SITE);
  world.game = { lat: r.lat, lng: r.lng, placeText: r.placeText, areaId: r.areaId };
  world.attemptId = r.attemptId;
});

Then("I am a captain of the proposed site", async ({ world }) => {
  expect(await isAreaCaptain(world.game!.areaId!, world.email!)).toBe(true);
});

Then("I am a captain of the scheduled game", async ({ world }) => {
  expect(await isAreaCaptain(world.game!.areaId!, world.email!)).toBe(true);
});

// The proposer is rostered when their game forms, so the popup shows captain
// controls + "you've found your weekly game" — never a join / no-captain prompt.
Then("I am already in the game as its captain", async ({ page }) => {
  const card = page.locator(".game-card");
  await expect(card).toContainText(/captain controls/i, { timeout: 10000 });
  await expect(card).toContainText(/found your weekly game/i);
  await expect(card).not.toContainText(/join weekly game/i);
  await expect(card).not.toContainText(/this game has no captain/i);
});

// ── Email assertions (the AfterStep hook renders them into the report) ──────────

// On the first tick the pending GAME_PROPOSED ask flushes to the cohort.
Then("the proposal email goes out", async () => {
  await expect.poll(
    async () => (await allEmails()).some((e) => /proposed near you/i.test(e.subject)),
    { timeout: 10000 },
  ).toBe(true);
});

// On confirm: the proposer (now rostered) gets "game on — you're in", carrying
// the spot, time, and the founding roster — the same details as the weekly email.
Then("I get the game-on email", async ({ world }) => {
  const me = world.email!.toLowerCase();
  await expect.poll(async () => {
    const won = (await allEmails()).find((e) => e.to.toLowerCase() === me && /game on/i.test(e.subject));
    return won ? /Republic Square/.test(won.html) && /planning to play/i.test(won.html) : false;
  }, { timeout: 10000 }).toBe(true);
});

// On fail: the cohort gets the "not enough players this round" notice.
Then("everyone hears the proposal fell short", async () => {
  await expect.poll(
    async () => (await allEmails()).some((e) => /not enough players/i.test(e.subject)),
    { timeout: 10000 },
  ).toBe(true);
});

// The only propose affordance is the map gesture (long-press on touch,
// right-click on desktop) — no floating button. A prominent legend cue makes it
// discoverable.
Then("the map explains how to propose a game", async ({ page }) => {
  const hint = page.locator(".legend-propose");
  await expect(hint).toBeVisible({ timeout: 10000 });
  await expect(hint).toContainText(/long-press/i);
});
