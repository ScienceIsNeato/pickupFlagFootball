import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import {
  seedNeighborsInMyArea, openProposalBackedBy, confirmProposalIntoGame,
  seedGameRosteredInMyArea, gameRosterCount,
} from "../support/db";

// Reuses "I am a confirmed player …" and "I open the map" (registered globally
// by other step files). This is the single HUD walkthrough: one login, one
// persistent cohort of real neighbors that backs the proposal and rosters the
// games — every number the HUD shows is real interest, never fabricated.

// The story is about the HUD alone — its report beats capture just the widget,
// not the whole map. World.beatLens (world.ts) is read by the AfterStep hook
// (hooks.ts) to screenshot one element instead of the full page.
Given("the report captures only the HUD", async ({ world }) => {
  world.beatLens = ".map-hud";
});

Then("the HUD tells me I'm the first one here", async ({ page }) => {
  await expect(page.locator(".map-hud-h")).toContainText(/first one here/i, { timeout: 10000 });
});

// The mini-FAQ interpolates the area's LIVE pMin (default 6), not a hardcoded
// count — so "once N say yes" tracks the real threshold. Find the formation
// answer by its question (not by position/count) so adding other FAQ items
// (e.g. "what am i looking at?") never breaks this.
Then("the HUD's FAQ explains how a game forms, with the live threshold", async ({ page }) => {
  const formation = page.locator(".map-hud-faq-item").filter({ hasText: "how do games actually form" });
  await expect(formation).toBeVisible({ timeout: 10000 });
  await formation.locator("summary").click();
  await expect(formation).toContainText(/once 6 say yes/i);
});

Then("the HUD offers a copyable share post", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-write"]);
  const btn = page.locator(".map-hud-copy").first();
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(btn).toContainText(/copied/i);
});

// The cohort is created ONCE and reused (stored on world) — the same real
// people carry through the proposal and the game rosters.
When("{int} neighbors show real interest in my own area", async ({ world }, n: number) => {
  world.cohort = await seedNeighborsInMyArea(world.email!, n);
});

// Each transition asserts AFTER nudging the HUD with the same "mime:hud-stale"
// event a real map action fires — so the beat (and its screenshot) is captured
// on the descriptive assertion step, not a generic "area changed" step. The 10s
// assert window is under the 15s poll, so a pass proves the event drove the
// refresh (not the interval): the live-refresh is covered at every beat.
async function nudge(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("mime:hud-stale")));
}

// Isolated ZIP (nobody else touches it), so the exact live total (viewer + N
// neighbors) is asserted precisely — proving the number is interpolated.
Then("the HUD tells me {int} people are interested near me", async ({ page }, total: number) => {
  await nudge(page);
  await expect(page.locator(".map-hud-h")).toContainText(new RegExp(`${total} interested in`, "i"), { timeout: 10000 });
  await expect(page.locator(".map-hud-body")).toContainText(new RegExp(`${total - 1} others? nearby`, "i"));
});

// The proposal is backed by the WHOLE cohort — its tally is real interest.
When("those neighbors back a proposal at {string}", async ({ world }, place: string) => {
  world.attemptId = await openProposalBackedBy(world.email!, place, world.cohort!);
});

Then("the HUD tells me a game's been proposed at {string} with {int} of {int} in",
  async ({ page }, place: string, inCount: number, pMin: number) => {
    await nudge(page);
    await expect(page.locator(".map-hud-h")).toContainText(/proposed/i, { timeout: 10000 });
    await expect(page.locator(".map-hud-body")).toContainText(new RegExp(place));
    await expect(page.locator(".map-hud-body")).toContainText(new RegExp(`${inCount}/${pMin} people are in`, "i"));
  });

// The proposal confirms into a real standing game, rostered with its backers.
When("the proposal fills and the game is on", async ({ world }) => {
  world.gameId = await confirmProposalIntoGame(world.email!, world.attemptId!, world.cohort!);
});

Then("the HUD tells me there's a game near me", async ({ page }) => {
  await nudge(page);
  await expect(page.locator(".map-hud-h")).toContainText(/there's a game near you/i, { timeout: 10000 });
});

// The whole point: the game isn't a ghost — real people are on its roster.
Then("that game is backed by a real {int}-player roster", async ({ world }, n: number) => {
  expect(await gameRosterCount(world.gameId!)).toBe(n);
});

When("those neighbors form a second game at {string}", async ({ world }, place: string) => {
  world.secondGameId = await seedGameRosteredInMyArea(world.email!, place, world.cohort!);
});

// The multi-game variant drops the single place name for a count — distinct
// copy, so the walkthrough asserts (and screenshots) it as its own state.
Then("the HUD tells me there are {int} games near me", async ({ page }, n: number) => {
  await nudge(page);
  await expect(page.locator(".map-hud-h")).toContainText(new RegExp(`${n} games near you`, "i"), { timeout: 10000 });
});

Then("both games are backed by real rosters", async ({ world }) => {
  expect(await gameRosterCount(world.gameId!)).toBeGreaterThan(0);
  expect(await gameRosterCount(world.secondGameId!)).toBeGreaterThan(0);
});
