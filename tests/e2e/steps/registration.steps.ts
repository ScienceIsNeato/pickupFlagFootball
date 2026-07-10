import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { waitForEmailTo, extractConfirmLink } from "../support/mailpit";
import { registerViaUi } from "../support/flows";

Given("I open the landing page", async ({ page }) => {
  await page.goto("/");
});

When('I click "count me in"', async ({ page }) => {
  await page.locator('a[href="/show-interest"]').first().click();
  await page.waitForURL("**/show-interest");
  await expect(page.locator('form.reg-form input[name="email"]')).toBeVisible();
});

When(
  "I register as {string} with email {string} password {string} in ZIP {string}",
  async ({ page, world }, name: string, email: string, password: string, zip: string) => {
    await registerViaUi(page, world, { name, email, password, zip });
    // Lands on the map, unconfirmed → the legend renders and the
    // confirm-your-email banner is up (you can't join/propose until you confirm).
    await expect(page.locator(".map-legend")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".unverified-banner")).toBeVisible();
  },
);

Then("I receive a confirmation email", async ({ world }) => {
  const mail = await waitForEmailTo(world.email!);
  world.confirmLink = extractConfirmLink(mail.html);
  // The AfterStep hook captures the email itself into the report.
});

When("I click the confirm link in my email", async ({ page, world }) => {
  if (!world.confirmLink) {
    const mail = await waitForEmailTo(world.email!);
    world.confirmLink = extractConfirmLink(mail.html);
  }
  // The email link is a GET that shows a confirm button — it must NOT verify on
  // its own (mail-scanner safety). Only the button's POST confirms.
  await page.goto(world.confirmLink);
  await page.getByRole("button", { name: "confirm my email" }).click();
  // Explicit success page, then the signed-up (already logged-in) device can
  // head to the map.
  await expect(page.getByRole("heading", { name: /email confirmed/i })).toBeVisible({ timeout: 15000 });
  // main's CTA, not the nav's "find a game" link (same text)
  await page.locator("main a.btn-green-link").click();
  await page.waitForURL("**/play", { timeout: 15000 });
  await expect(page.locator(".map-legend")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".unverified-banner")).toHaveCount(0);
});

When("a mail scanner opens the confirm link", async ({ page, world }) => {
  if (!world.confirmLink) {
    const mail = await waitForEmailTo(world.email!);
    world.confirmLink = extractConfirmLink(mail.html);
  }
  // Simulate a link-scanner / prefetch: GET the URL, never click the button.
  await page.goto(world.confirmLink);
});

Then("the confirm link still works for me", async ({ page }) => {
  // The scanner's GET must not have consumed the single-use token: the confirm
  // button is still present, and clicking it now succeeds.
  await expect(page.getByRole("button", { name: "confirm my email" })).toBeVisible();
  await page.getByRole("button", { name: "confirm my email" }).click();
  await expect(page.getByRole("heading", { name: /email confirmed/i })).toBeVisible({ timeout: 15000 });
});
