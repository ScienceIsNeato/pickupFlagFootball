import { expect } from "@playwright/test";
import { When, Then } from "./world";
import { proposeAsUser, isAreaCaptain } from "../support/db";
import { allEmails } from "../support/mailpit";

// Reuses "I am a confirmed player …", "I open the game on the map", and the
// formation-FSM steps (suggestion/availability windows, commit, schedule/stall).
const SITE = { lat: 30.281, lng: -97.742, placeText: "Republic Square", city: "Austin", zip: "78701" };

When("I propose a game at a nearby spot", async ({ world }) => {
  const r = await proposeAsUser(world.email!, SITE);
  world.game = { lat: r.lat, lng: r.lng, placeText: r.placeText, areaId: r.areaId };
  world.attemptId = r.attemptId;
});

Then("I am a captain of the proposed site", async ({ world }) => {
  expect(await isAreaCaptain(world.game!.areaId!, world.email!)).toBe(true);
});

// After the formation confirms, the game inherits the area's captains — so the
// proposer is still a captain of the scheduled game.
Then("I am a captain of the scheduled game", async ({ world }) => {
  expect(await isAreaCaptain(world.game!.areaId!, world.email!)).toBe(true);
});

// The proposer is rostered when their game forms (engine adds the winning option's
// suggesters), so the popup shows captain controls + "you're in" — never a "join
// weekly game" prompt or a "no captain" plea.
Then("I am already in the game as its captain", async ({ page }) => {
  const card = page.locator(".game-card");
  await expect(card).toContainText(/captain controls/i, { timeout: 10000 });
  await expect(card).toContainText(/found your weekly game/i);
  await expect(card).not.toContainText(/join weekly game/i);
  await expect(card).not.toContainText(/this game has no captain/i);
});

// ── Email beats: capture what the flow actually sent (Mailpit) and render it into
//    the story report, so the report shows the inboxes, not just the UI. ──────────

// These steps assert the RIGHT emails fired (teeth); the AfterStep hook renders
// them into the report automatically when the triggering tick flushes them.

// After the suggestion window closes: the cohort gets the spark + options asks.
Then("the courting emails go out", async () => {
  await expect.poll(async () => {
    const subjects = (await allEmails()).map((e) => e.subject).join(" | ");
    return /forming near you/i.test(subjects) && /vote on where & when/i.test(subjects);
  }, { timeout: 10000 }).toBe(true);
});

// On confirm: the proposer (now rostered) gets the "game on — you're in" email.
Then("I get the game-on email", async ({ world }) => {
  const me = world.email!.toLowerCase();
  await expect.poll(
    async () => (await allEmails()).some((e) => e.to.toLowerCase() === me && /game on/i.test(e.subject)),
    { timeout: 10000 },
  ).toBe(true);
});

// On stall: the cohort gets the "not enough players this round" notice.
Then("everyone hears the formation stalled", async () => {
  await expect.poll(
    async () => (await allEmails()).some((e) => /not enough players/i.test(e.subject)),
    { timeout: 10000 },
  ).toBe(true);
});
