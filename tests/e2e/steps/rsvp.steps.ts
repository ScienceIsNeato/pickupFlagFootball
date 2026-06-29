import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { seedRosterMember, seedScheduledOccurrence } from "../support/db";
import { allEmails, extractButtonLink } from "../support/mailpit";

Given("I am on the roster with a game scheduled this week", async ({ world }) => {
  await seedRosterMember(world.game!.gameId!, world.email!);
  // Enqueues a POLL_ASK to me — the next tick flushes the weekly rsvp email.
  world.occurrenceId = await seedScheduledOccurrence(world.game!.gameId!, world.email!);
});

Then("the weekly rsvp email reaches me", async ({ world }) => {
  const me = world.email!.toLowerCase();
  await expect.poll(
    async () => (await allEmails()).some((e) => e.to.toLowerCase() === me && /this week's game/i.test(e.subject)),
    { timeout: 10000 },
  ).toBe(true);
});

When("I open my {string} rsvp link", async ({ page, world }, label: string) => {
  const me = world.email!.toLowerCase();
  // The weekly poll email by subject (registration sent a verification email to
  // the same inbox), then the real link behind its "i'm in" button.
  const poll = (await allEmails()).find((e) => e.to.toLowerCase() === me && /this week's game/i.test(e.subject));
  if (!poll) throw new Error(`no weekly poll email in ${me}'s inbox`);
  await page.goto(extractButtonLink(poll.html, label)); // the real link from the email
  await expect(page.getByRole("heading", { name: /rsvp for/i })).toBeVisible({ timeout: 10000 });
});

When("I confirm the rsvp", async ({ page }) => {
  await page.getByRole("button", { name: /confirm.*i'm in/i }).click();
});

Then("I'm marked in for the week", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /you're in/i })).toBeVisible({ timeout: 10000 });
});
