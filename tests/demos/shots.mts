/**
 * Captures the splash-gallery stills: one clean screenshot per core flow, shot
 * through the real app against a clean, realistic seed. Writes JPEGs straight to
 * public/gallery/ — no cursor overlay, no video, no ffmpeg.
 *
 * Run via scripts/shoot_demos.sh (brings up the stack, seeds, starts the app).
 */
import { chromium, type Page, type Browser } from "@playwright/test";
import { Pool } from "pg";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { E2E } from "../e2e/support/env";
import { resetData, seedStandingGame, markEmailVerified, seedRosterMember, seedCaptain } from "../e2e/support/db";
import { registerViaUi } from "../e2e/support/flows";

const BASE = E2E.appBaseUrl;
const VP = { width: 1120, height: 704 };
const OUT = path.join(process.cwd(), "public/gallery");
mkdirSync(OUT, { recursive: true });

const pool = new Pool({ connectionString: E2E.dbUrl });

// A recognisable Austin park, in the 78701 catchment we register demo users into.
const SITE = { lat: 30.2669, lng: -97.7729, placeText: "Zilker Park", city: "Austin", zip: "78701" };
const ALEX = { name: "Alex", email: "alex@example.com", zip: "78701" };

const sleep = (p: Page, ms: number) => p.waitForTimeout(ms);

async function centerOnGame(page: Page, lat: number, lng: number) {
  await page.locator("canvas.maplibregl-canvas").waitFor({ timeout: 15000 });
  const feed = page.waitForResponse((r) => r.url().includes("/api/map") && r.url().includes("res=7"), { timeout: 15000 });
  await page.evaluate(({ lat, lng }) => {
    (window as unknown as { __e2eMap?: { jumpTo: (o: unknown) => void } }).__e2eMap?.jumpTo({ center: [lng, lat], zoom: 12 });
  }, { lat, lng });
  await feed;
  await sleep(page, 900);
}

async function openGame(page: Page, lat: number, lng: number) {
  await centerOnGame(page, lat, lng);
  const map = page.locator(".dash-map");
  await map.waitFor({ timeout: 10000 });
  const box = await map.boundingBox();
  if (!box) throw new Error("no box for .dash-map");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator(".game-card").waitFor({ timeout: 10000 });
  await sleep(page, 700);
}

// Each still shoots in its own context (clean cookies) against the seeded app.
async function shot(browser: Browser, name: string, storageState: string | undefined, flow: (page: Page) => Promise<void>) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2, baseURL: BASE, storageState });
  const page = await ctx.newPage();
  try {
    await flow(page);
    await sleep(page, 300);
    await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 88 });
    console.log(`  ✓ ${name}`);
  } finally {
    await ctx.close();
  }
}

async function main() {
  // Clean, lively base: a standing game at Zilker with a full roster + some
  // ambient interest so the map reads as an active area, not an empty one.
  await resetData();
  const game = await seedStandingGame({ ...SITE, regulars: 14, interested: 8 });

  const browser = await chromium.launch();
  try {
    // A signed-in demo user for the play-side shots. Registered once via the real
    // form, then reused via storageState so the shots start already on the map.
    const authCtx = await browser.newContext({ viewport: VP, baseURL: BASE });
    const authPage = await authCtx.newPage();
    await registerViaUi(authPage, { email: "" } as unknown as import("../e2e/steps/world").World, ALEX);
    await markEmailVerified(ALEX.email);
    const AUTH = path.join(process.cwd(), "tests/demos/.auth.json");
    await authCtx.storageState({ path: AUTH });
    await authCtx.close();

    console.log("capturing stills…");

    // 1) Showing interest — a clean, part-filled registration form.
    await shot(browser, "show-interest", undefined, async (page) => {
      await page.goto("/show-interest");
      await page.locator('input[name="email"]').waitFor({ timeout: 15000 });
      await page.fill('input[name="email"]', "riley@example.com");
      await page.fill('input[name="username"]', "Riley");
      await page.fill('input[name="password"]', "hunter2pass");
      await page.fill('input[name="zip"]', "78701");
    });

    // 2) Joining a regular game — the map with the game card + join button open.
    await pool.query(
      "DELETE FROM game_roster WHERE game_id = $1 AND user_id = (SELECT id FROM users WHERE lower(email)=lower($2))",
      [game.gameId, ALEX.email],
    );
    await shot(browser, "join-game", AUTH, async (page) => {
      await page.goto("/play");
      await openGame(page, game.lat, game.lng);
    });

    // 3) Attending a weekly game — a member has tapped "i'm in" for the week.
    await seedRosterMember(game.gameId, ALEX.email, "out");
    await shot(browser, "attend-week", AUTH, async (page) => {
      await page.goto("/play");
      await openGame(page, game.lat, game.lng);
      await page.getByRole("button", { name: "i'm in", exact: true }).first().click();
      await page.locator(".game-leave, .game-in").first().waitFor({ timeout: 10000 }).catch(() => {});
      await sleep(page, 600);
    });

    // 4) Pausing the series as captain — the pause dialog, filled in.
    await seedCaptain(game.areaId, ALEX.email);
    await shot(browser, "captain-pause", AUTH, async (page) => {
      await page.goto("/play");
      await openGame(page, game.lat, game.lng);
      await page.getByRole("button", { name: "pause series", exact: true }).first().click();
      const dlg = page.getByRole("alertdialog");
      await dlg.waitFor({ timeout: 5000 });
      await dlg.locator('input[type="date"]').fill("2099-09-01");
      await dlg.locator("textarea").fill("summer break — back in september");
      await sleep(page, 400);
    });
  } finally {
    await browser.close();
    await pool.end();
  }
  console.log("done — stills in public/gallery/");
}

await main();
