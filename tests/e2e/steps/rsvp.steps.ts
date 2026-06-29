import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { seedRosterMember, seedScheduledOccurrence, getUserId } from "../support/db";
import { E2E } from "../support/env";
// Relative (not "@/…") so it resolves at runtime under playwright-bdd's loader.
import { signRsvpToken } from "../../../lib/rsvpLink";

Given("I am on the roster with a game scheduled this week", async ({ world }) => {
  const gameId = world.game!.gameId!;
  await seedRosterMember(gameId, world.email!);
  const occurrenceId = await seedScheduledOccurrence(gameId);
  const userId = await getUserId(world.email!);
  // Sign with the same secret the app verifies under (see playwright webServer.env).
  process.env.AUTH_SECRET = E2E.authSecret;
  world.rsvpToken = signRsvpToken(userId, occurrenceId, "in");
});

When("I open my {string} rsvp link", async ({ page, world }, _label: string) => {
  await page.goto(`/rsvp?t=${encodeURIComponent(world.rsvpToken!)}`);
  await expect(page.getByRole("heading", { name: /rsvp for/i })).toBeVisible({ timeout: 10000 });
});

When("I confirm the rsvp", async ({ page }) => {
  await page.getByRole("button", { name: /confirm.*i'm in/i }).click();
});

Then("I'm marked in for the week", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /you're in/i })).toBeVisible({ timeout: 10000 });
});
