import { expect, type Page } from "@playwright/test";
import { Given, When, Then } from "./world";
import { E2E } from "../support/env";
import { getUserId, getDonationStatus, seedRosterMember } from "../support/db";
// Relative import so it resolves under playwright-bdd's loader.
import Stripe from "stripe";

const CUSTOMER = "cus_e2e_test";
const stripe = new Stripe(E2E.stripeSecretKey); // key only constructs the client; signing uses the secret below

// POST a signed Stripe event to the webhook, the same way Stripe would.
async function postEvent(page: Page, event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: E2E.stripeWebhookSecret });
  const res = await page.request.post(`${E2E.appBaseUrl}/api/stripe/webhook`, {
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    data: payload,
  });
  expect(res.ok(), `webhook returned ${res.status()}`).toBeTruthy();
}

When("Stripe reports their subscription started", async ({ page, world }) => {
  const userId = await getUserId(world.email!);
  await postEvent(page, {
    id: "evt_e2e_started", object: "event", type: "checkout.session.completed",
    data: { object: { object: "checkout.session", mode: "subscription", client_reference_id: userId, customer: CUSTOMER, subscription: "sub_e2e" } },
  });
});

Then("they're marked as a subscriber", async ({ world }) => {
  expect(await getDonationStatus(world.email!)).toBe("subscribed");
});

When("Stripe reports their subscription cancelled", async ({ page }) => {
  await postEvent(page, {
    id: "evt_e2e_cancelled", object: "event", type: "customer.subscription.deleted",
    data: { object: { object: "subscription", id: "sub_e2e", customer: CUSTOMER } },
  });
});

Then("the donation reminder is back on", async ({ world }) => {
  expect(await getDonationStatus(world.email!)).toBe("unset");
});

// ── support-nudge banner ─────────────────────────────────────────────────────
Given("I am on that game's roster", async ({ page, world }) => {
  await seedRosterMember(world.game!.gameId!, world.email!);
  // Load the map so this step's report screenshot reflects the seeded state
  // (member of an active game) rather than a stale pre-seed page.
  await page.goto("/play");
});

When("I open the map", async ({ page }) => {
  await page.goto("/play");
});

Then("I see the support banner", async ({ page }) => {
  await expect(page.locator(".donate-banner")).toBeVisible({ timeout: 10000 });
});

When("I dismiss the support banner with {string}", async ({ page }, _label: string) => {
  await page.locator(".donate-banner-stop").click();
});

Then("the support banner is gone", async ({ page }) => {
  await expect(page.locator(".donate-banner")).toHaveCount(0, { timeout: 10000 });
});

// The banner's dismiss is fire-and-forget, so poll for the persisted write.
Then("the donation reminder is off", async ({ world }) => {
  await expect.poll(() => getDonationStatus(world.email!), { timeout: 10000 }).toBe("declined");
});

Then("I do not see the support banner on the map", async ({ page }) => {
  await page.goto("/play");
  await expect(page.locator(".donate-banner")).toHaveCount(0, { timeout: 10000 });
});

When("I turn off the donation reminder in account settings", async ({ page }) => {
  await page.goto("/account");
  const cb = page.locator('input[name="remind"]');
  await expect(cb).toBeChecked();
  await cb.uncheck();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator(".save-toast")).toBeVisible({ timeout: 10000 });
});

When("I turn on the donation reminder in account settings", async ({ page }) => {
  await page.goto("/account");
  await page.locator('input[name="remind"]').check();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator(".save-toast")).toBeVisible({ timeout: 10000 });
});
