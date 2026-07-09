import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { seedFormingAttempt, seedAreaOptout } from "../support/db";
import { allEmails, extractButtonLink } from "../support/mailpit";

// Reuses "I am a confirmed player …" and "I open the game on the map" — clicking
// the forming badge opens the proposed-site popup (also a .game-card).
const SITE = { lat: 30.281, lng: -97.742, placeText: "Republic Square", city: "Austin", zip: "78701" };

Given("a forming game site near me", async ({ world }) => {
  const r = await seedFormingAttempt(SITE);
  world.game = { lat: r.lat, lng: r.lng, placeText: r.placeText, areaId: r.areaId };
  world.attemptId = r.attemptId;
});

// Same seed, but it also enqueues a GAME_PROPOSED ask to me — so a tick delivers
// the real proposal email to my inbox (with its not-interested link to click).
Given("a neighbor proposes a game near me, asking me in", async ({ world }) => {
  const r = await seedFormingAttempt({ ...SITE, notifyEmail: world.email! });
  world.game = { lat: r.lat, lng: r.lng, placeText: r.placeText, areaId: r.areaId };
  world.attemptId = r.attemptId;
});

Then("the proposal email reaches me", async ({ world }) => {
  const me = world.email!.toLowerCase();
  await expect.poll(
    async () => (await allEmails()).some((e) => e.to.toLowerCase() === me && /proposed near you/i.test(e.subject)),
    { timeout: 10000 },
  ).toBe(true);
  // The proposal email never carries a donation ask — that lives only on week-on.
  const proposal = (await allEmails()).find((e) => e.to.toLowerCase() === me && /proposed near you/i.test(e.subject));
  // Confirm the body actually loaded (Mailpit's detail fetch can degrade to empty
  // html) before asserting the donation ask is absent — else an empty body passes.
  expect(proposal?.html, "proposal email HTML should be loaded").toMatch(/not interested/i);
  expect(proposal!.html, "proposal email must not carry a donation ask").not.toMatch(/chip in/i);
});

When("I say I'm not interested", async ({ page }) => {
  await page.getByRole("button", { name: "not interested" }).click();
});

Then("the proposal shows I'm out", async ({ page }) => {
  await expect(page.getByRole("button", { name: "not interested" }))
    .toHaveAttribute("aria-pressed", "true", { timeout: 10000 });
});

When("I say I'm interested after all", async ({ page }) => {
  await page.getByRole("button", { name: /i.?m interested/i }).click();
});

Then("the proposal shows I'm in", async ({ page }) => {
  await expect(page.locator(".game-card")).toContainText(/you're in/i, { timeout: 10000 });
  await expect(page.getByRole("button", { name: /i.?m interested/i }))
    .toHaveAttribute("aria-pressed", "true");
});

When("I open my not-interested email link", async ({ page, world }) => {
  const me = world.email!.toLowerCase();
  // The proposal email by subject — registration already sent a verification email
  // to the same inbox, so "first email to me" would be the wrong one.
  const proposal = (await allEmails()).find((e) => e.to.toLowerCase() === me && /proposed near you/i.test(e.subject));
  if (!proposal) throw new Error(`no proposal email in ${me}'s inbox`);
  await page.goto(extractButtonLink(proposal.html, "not interested")); // the real link from the email
  await expect(page.getByRole("heading", { name: /not this one/i })).toBeVisible({ timeout: 10000 });
});

When("I confirm not interested from the email", async ({ page }) => {
  await page.getByRole("button", { name: "confirm" }).click();
});

Then("I'm marked not interested", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /no worries/i })).toBeVisible({ timeout: 10000 });
});

Given("I have opted out of my area", async ({ world }) => {
  await seedAreaOptout(world.email!);
});

When("I open my account page", async ({ page }) => {
  await page.goto("/account");
});

Then("I see the area I opted out of and can rejoin it", async ({ page }) => {
  const section = page.locator(".acct-vitals", { hasText: "areas you've opted out of" });
  await expect(section).toBeVisible({ timeout: 10000 });
  const rejoin = section.getByRole("button", { name: "i'm interested again" });
  await expect(rejoin).toHaveCount(1);
  await rejoin.click();
  // The row (and section) clear once the opt-out is undone.
  await expect(section).toHaveCount(0, { timeout: 10000 });
});
