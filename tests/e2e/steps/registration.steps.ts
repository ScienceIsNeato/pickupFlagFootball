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

Then("I receive a confirmation email", async ({ page, world }) => {
  const mail = await waitForEmailTo(world.email!);
  world.confirmLink = extractConfirmLink(mail.html);
  // Render the email into the page so this beat's screenshot shows the email.
  await page.setContent(mail.html);
});

When("I click the confirm link in my email", async ({ page, world }) => {
  if (!world.confirmLink) {
    const mail = await waitForEmailTo(world.email!);
    world.confirmLink = extractConfirmLink(mail.html);
  }
  await page.goto(world.confirmLink);
  await page.waitForURL("**/play", { timeout: 15000 });
  // Confirmed: back on the map with the unconfirmed banner gone.
  await expect(page.locator(".map-legend")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".unverified-banner")).toHaveCount(0);
});
