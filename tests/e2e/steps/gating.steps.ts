import { expect } from "@playwright/test";
import { When, Then } from "./world";
import { clearMailpit } from "../support/mailpit";
import { deleteUserByEmail } from "../support/db";

// ── confirm link / resend ───────────────────────────────────────────────────

When("I open an invalid confirm link", async ({ page }) => {
  // Well-formed token (64 hex) that matches no stored hash → the failure page.
  await page.goto("/verify-email?token=" + "a".repeat(64));
  await expect(page.getByRole("heading", { name: "this link didn't work" })).toBeVisible();
});

When("I resend the confirmation from the banner", async ({ page }) => {
  // Drop the registration email first so a fresh one proves the resend worked.
  await clearMailpit();
  await page.locator(".unverified-resend").click();
  await expect(page.locator(".unverified-resend")).toContainText("sent");
});

// ── propose gating ──────────────────────────────────────────────────────────

When("I right-click the map to propose a spot", async ({ page }) => {
  // The map must be initialized for its contextmenu handler to fire.
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 15000 });
  const box = await page.locator(".dash-map").boundingBox();
  if (!box) throw new Error("no map element to right-click");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Scope to the modal's title — the map now also has a "+ propose a game here"
  // button, so a bare getByText("propose a game") would match two elements.
  await expect(dialog.locator("#propose-title")).toHaveText(/propose a game/i);
});

Then("filling in the proposal tells me to confirm my email", async ({ page }) => {
  // city/zip prefill from the user's home (Austin / 78701); fill the rest.
  await page.fill('input[name="place_street"]', "Zilker Park");
  const selects = page.locator(".reg-form select");
  await selects.nth(0).selectOption({ index: 1 }); // day of week
  await selects.nth(1).selectOption({ index: 1 }); // time
  await selects.nth(2).selectOption({ index: 1 }); // date of first game
  await page.getByRole("button", { name: "propose it" }).click();
  const err = page.getByText(/confirm your email before proposing/i);
  await expect(err).toBeVisible();
  // The error renders at the top of a scrollable modal; bring it into view so the
  // beat's screenshot actually shows it.
  await err.scrollIntoViewIfNeeded();
});

// ── session integrity (ghost) ───────────────────────────────────────────────

Then("after my account is deleted, reloading sends me to sign in", async ({ page, world }) => {
  await deleteUserByEmail(world.email!);
  await page.reload();
  // Bounced off /play back to the public landing → no longer signed in.
  await expect(page).toHaveURL(/\/($|\?)/);
  await expect(page.locator('a[href="/show-interest"]').first()).toBeVisible();
});
