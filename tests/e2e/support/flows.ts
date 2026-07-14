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
  await page.fill('input[name="email"]', opts.email);
  await page.fill('input[name="username"]', opts.name);
  await page.fill('input[name="password"]', opts.password ?? "hunter2pass");
  await page.fill('input[name="zip"]', opts.zip);
  world.email = opts.email;
  // The register→signIn→/play hop is CPU-heavy (two password hashes) and drags
  // way out on CI's 2-core runners, where it's ~15× slower than local. Give it a
  // roomy budget in CI (still bounded by the mobile project's 90s per-test cap);
  // locally keep it tight so a real regression surfaces fast.
  await Promise.all([
    page.waitForURL("**/play", { timeout: process.env.CI ? 85_000 : 30_000 }),
    page.getByRole("button", { name: "count me in" }).click(),
  ]);
}
