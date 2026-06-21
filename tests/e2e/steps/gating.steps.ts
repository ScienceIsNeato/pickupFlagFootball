import { expect } from "@playwright/test";
import { Given, When, Then } from "./world";
import { clearMailpit } from "../support/mailpit";
import { deleteUserByEmail } from "../support/db";

// ── confirm link / resend ───────────────────────────────────────────────────

When("I open an invalid confirm link", async ({ page }) => {
  // Well-formed token (64 hex) that matches no stored hash → the failure page.
  await page.goto("/verify-email?token=" + "a".repeat(64));
});

Then("I see the {string} page", async ({ page }, text: string) => {
  await expect(page.getByRole("heading", { name: text })).toBeVisible();
});

Given("my inbox is empty", async () => {
  await clearMailpit();
});

When("I click {string} on the banner", async ({ page }, _label: string) => {
  await page.locator(".unverified-resend").click();
});

Then("the resend button shows {string}", async ({ page }, text: string) => {
  await expect(page.locator(".unverified-resend")).toContainText(text);
});

// ── propose gating ──────────────────────────────────────────────────────────

When("I right-click the map to propose a spot", async ({ page }) => {
  // The map must be initialized for its contextmenu handler to fire.
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 15000 });
  const box = await page.locator(".dash-map").boundingBox();
  if (!box) throw new Error("no map element to right-click");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
});

Then("the propose form opens", async ({ page }) => {
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("propose a game")).toBeVisible();
});

When("I fill in the proposal and submit it", async ({ page }) => {
  // city/zip prefill from the user's home (Austin / 78701); fill the rest.
  await page.fill('input[name="place_street"]', "Zilker Park");
  // Positional selects in the modal: day of week, time, then date (the date
  // select enables and populates only after a day is chosen).
  const selects = page.locator(".reg-form select");
  await selects.nth(0).selectOption({ index: 1 }); // day of week
  await selects.nth(1).selectOption({ index: 1 }); // time
  await selects.nth(2).selectOption({ index: 1 }); // date of first game
  await page.getByRole("button", { name: "propose it" }).click();
});

Then("I am told to confirm my email before proposing", async ({ page }) => {
  await expect(page.getByText(/confirm your email before proposing/i)).toBeVisible();
});

// ── session integrity (ghost) ───────────────────────────────────────────────

When("my account is deleted from the database", async ({ world }) => {
  await deleteUserByEmail(world.email!);
});

When("I reload the page", async ({ page }) => {
  await page.reload();
});

Then("I am sent to sign in", async ({ page }) => {
  // Bounced off /play back to the public landing (the ?signin=1 param is stripped
  // once the sign-in modal opens) → no longer signed in.
  await expect(page).toHaveURL(/\/($|\?)/);
  await expect(page.locator('a[href="/show-interest"]').first()).toBeVisible();
});
