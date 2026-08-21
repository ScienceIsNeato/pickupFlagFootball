import { type Page } from "@playwright/test";
import type { World } from "../steps/world";

/**
 * Register a new account + location through the real /show-interest form and
 * land on the map. Shared by every step that needs a signed-in user, so the
 * field/submit details live in one place.
 */
export async function registerViaUi(
  page: Page,
  world: World,
  opts: { name: string; email: string; zip: string; password?: string },
): Promise<void> {
  if (!page.url().includes("/show-interest")) await page.goto("/show-interest");
  // L3 location: a plain ZIP field confirmed against the local centroid table
  // (hermetic; Nominatim only enriches the label and is never waited on).
  await page.fill('input[name="zip"]', opts.zip);
  await page.locator('[data-testid="zip-ok"]').waitFor({ timeout: 10000 });
  await page.fill('input[name="email"]', opts.email);
  await page.fill('input[name="username"]', opts.name);
  await page.fill('input[name="password"]', opts.password ?? "hunter2pass");
  world.email = opts.email;
  await Promise.all([
    page.waitForURL("**/play", { timeout: 30000 }),
    page.getByRole("button", { name: "count me in" }).click(),
  ]);
}
