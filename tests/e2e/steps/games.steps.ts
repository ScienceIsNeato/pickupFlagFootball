import { expect, type Page } from "@playwright/test";
import { Given, When, Then } from "./world";
import type { World } from "./world";
import { seedStandingGame, markEmailVerified } from "../support/db";

// A venue ~1km from the 78701 home (in radius) and one at Cedar Park 78613
// (~27km, outside the 15mi default radius).
const NEAR = { lat: 30.281, lng: -97.742, placeText: "Republic Square", city: "Austin", zip: "78701" };
const FAR = { lat: 30.5052, lng: -97.8203, placeText: "Cedar Park Field", city: "Cedar Park", zip: "78613" };

async function registerViaUi(page: Page, world: World, name: string, email: string, zip: string) {
  await page.goto("/show-interest");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="username"]', name);
  await page.fill('input[name="password"]', "hunter2pass");
  await page.fill('input[name="zip"]', zip);
  world.email = email;
  await Promise.all([
    page.waitForURL("**/play", { timeout: 30000 }),
    page.getByRole("button", { name: "count me in" }).click(),
  ]);
}

/** Center the map on the seeded game and click its badge for real. */
async function openGameOnMap(page: Page, world: World) {
  const g = world.game!;
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 15000 });
  const mapFeed = page.waitForResponse(
    (r) => r.url().includes("/api/map") && r.url().includes("res=7"),
    { timeout: 15000 },
  );
  await page.evaluate(({ lat, lng }) => {
    const m = (window as unknown as { __e2eMap?: { jumpTo: (o: unknown) => void } }).__e2eMap;
    if (!m) throw new Error("e2e map seam missing — build with NEXT_PUBLIC_E2E=1");
    m.jumpTo({ center: [lng, lat], zoom: 11 });
  }, g);
  await mapFeed.catch(() => {});
  await page.waitForTimeout(800); // let the badge draw from the fresh feed
  const box = await page.locator(".dash-map").boundingBox();
  if (!box) throw new Error("no map element");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".game-card")).toBeVisible({ timeout: 10000 });
}

Given("an established weekly game near me", async ({ world }) => {
  world.game = await seedStandingGame(NEAR);
});

Given("an established weekly game outside my travel radius", async ({ world }) => {
  world.game = await seedStandingGame(FAR);
});

Given(
  "I am a confirmed player {string} with email {string} in ZIP {string}",
  async ({ page, world }, name: string, email: string, zip: string) => {
    await registerViaUi(page, world, name, email, zip);
    await markEmailVerified(email);
  },
);

When("I open the game on the map", async ({ page, world }) => {
  await openGameOnMap(page, world);
});

When("I try to join the weekly game", async ({ page }) => {
  await page.getByRole("button", { name: "join weekly game" }).click();
});

When("I join the weekly game", async ({ page }) => {
  await page.getByRole("button", { name: "join weekly game" }).click();
  // The popup reloads on success — the leave control proves we're on the roster.
  await expect(page.locator(".game-leave")).toBeVisible({ timeout: 10000 });
});

Then("I am told to confirm my email", async ({ page }) => {
  await expect(page.locator(".game-err")).toContainText(/confirm your email/i);
});

Then("I am on the game's roster", async ({ page }) => {
  await expect(page.locator(".game-leave")).toBeVisible();
});

Then("the game shows in my games", async ({ page, world }) => {
  await page.goto("/my-games");
  await expect(page.getByText(world.game!.placeText).first()).toBeVisible({ timeout: 10000 });
});

Then("I am told the game is outside my travel radius", async ({ page }) => {
  await expect(page.locator(".game-card")).toContainText(/outside your travel radius/i);
});
