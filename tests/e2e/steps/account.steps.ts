import { expect } from "@playwright/test";
import { When, Then } from "./world";

// Reuses "I am a confirmed player …" (registers + verifies).

When("I open my account", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "you", exact: true })).toBeVisible({ timeout: 10000 });
});

When("I rename myself to {string}", async ({ page }, name: string) => {
  await page.fill("input[name=displayName]", name);
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator(".save-toast")).toBeVisible({ timeout: 10000 });
});

// Reload and assert the name stuck AND the location (zip) wasn't wiped.
Then("my account keeps name {string} and zip {string}", async ({ page }, name: string, zip: string) => {
  await page.reload();
  await expect(page.locator("input[name=displayName]")).toHaveValue(name);
  await expect(page.locator("input[name=zip]")).toHaveValue(zip);
});

When("I change my travel distance to {string}", async ({ page }, miles: string) => {
  await page.fill("input[name=max_travel_miles]", miles);
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator(".save-toast")).toBeVisible({ timeout: 10000 });
});

// Reload and assert the travel stuck AND the name wasn't wiped by the location save.
Then("my account keeps name {string} and travel {string}", async ({ page }, name: string, miles: string) => {
  await page.reload();
  await expect(page.locator("input[name=max_travel_miles]")).toHaveValue(miles);
  await expect(page.locator("input[name=displayName]")).toHaveValue(name);
});

// Chat email cadence. "off" is the checkbox, not a fourth radio, so the two controls
// can't disagree — asserting both together is the point.
Then("my chat emails are grouped", async ({ page }) => {
  await expect(page.locator("input[name=chat_email_on]")).toBeChecked();
  await expect(page.locator("input[name=chat_email_freq][value=hourly]")).toBeChecked();
});

When("I set chat emails to a daily summary", async ({ page }) => {
  await page.check("input[name=chat_email_freq][value=daily]");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator(".save-toast")).toBeVisible({ timeout: 10000 });
});

Then("my chat emails stay a daily summary", async ({ page }) => {
  await page.reload();
  await expect(page.locator("input[name=chat_email_on]")).toBeChecked();
  await expect(page.locator("input[name=chat_email_freq][value=daily]")).toBeChecked();
});

When("I turn off chat emails", async ({ page }) => {
  await page.uncheck("input[name=chat_email_on]");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator(".save-toast")).toBeVisible({ timeout: 10000 });
});

// Unchecking wins over whatever the radio still shows.
Then("chat emails stay off", async ({ page }) => {
  await page.reload();
  await expect(page.locator("input[name=chat_email_on]")).not.toBeChecked();
});

When("I turn off game emails", async ({ page }) => {
  await page.uncheck("input[name=email_opt_in]");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator(".save-toast")).toBeVisible({ timeout: 10000 });
});

// The global unsubscribe — the same flag the email footer's "unsubscribe" flips.
Then("game emails stay off", async ({ page }) => {
  await page.reload();
  await expect(page.locator("input[name=email_opt_in]")).not.toBeChecked();
});
