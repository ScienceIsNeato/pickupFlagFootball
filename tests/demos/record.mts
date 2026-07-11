/**
 * Records the splash-gallery demo clips: short, watchable walkthroughs of the
 * four core flows, driven through the real app with a clean, realistic seed.
 * Playwright captures webm; scripts/record_demos.sh converts + optimises them.
 *
 * Run via scripts/record_demos.sh (brings up the stack, seeds, starts the app).
 */
import { chromium, type Page, type Browser } from "@playwright/test";
import { Pool } from "pg";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { E2E } from "../e2e/support/env";
import { resetData, seedStandingGame, markEmailVerified, seedRosterMember, seedCaptain } from "../e2e/support/db";
import { registerViaUi } from "../e2e/support/flows";

const BASE = E2E.appBaseUrl;
const VP = { width: 1120, height: 704 };
const RAW = path.join(process.cwd(), "tests/demos/raw");
rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

const pool = new Pool({ connectionString: E2E.dbUrl });

// A recognisable Austin park, in the 78701 catchment we register demo users into.
const SITE = { lat: 30.2669, lng: -97.7729, placeText: "Zilker Park", city: "Austin", zip: "78701" };
const ALEX = { name: "Alex", email: "alex@example.com", zip: "78701" };

// A soft green pointer that follows the mouse and pulses on click, so viewers can
// see what's being tapped (Playwright's own recording has no cursor).
const CURSOR_INIT = `() => {
  const s = document.createElement('style');
  s.textContent = '#__dc{position:fixed;z-index:2147483647;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;background:rgba(70,137,68,.30);border:2px solid rgba(70,137,68,.95);pointer-events:none;opacity:0;transition:opacity .2s,transform .12s ease}#__dc.on{opacity:1}#__dc.tap{transform:scale(.55);background:rgba(70,137,68,.55)}';
  document.documentElement.appendChild(s);
  const c = document.createElement('div'); c.id = '__dc'; document.documentElement.appendChild(c);
  addEventListener('mousemove', e => { c.classList.add('on'); c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => c.classList.add('tap'), true);
  addEventListener('mouseup', () => c.classList.remove('tap'), true);
}`;

const sleep = (p: Page, ms: number) => p.waitForTimeout(ms);

/** Move the pointer smoothly to a locator's centre and click — reads as a real tap. */
async function tapLoc(page: Page, loc: import("@playwright/test").Locator, opts: { pauseBefore?: number } = {}) {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox();
  if (!box) throw new Error("no box for locator");
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 22 });
  await sleep(page, opts.pauseBefore ?? 350);
  await page.mouse.click(x, y);
}

async function tap(page: Page, selectorOrRole: { sel?: string; role?: { name: string } }, opts: { pauseBefore?: number } = {}) {
  const loc = selectorOrRole.sel
    ? page.locator(selectorOrRole.sel).first()
    : page.getByRole("button", { name: selectorOrRole.role!.name, exact: true }).first();
  await tapLoc(page, loc, opts);
}

/** Type with a human cadence into a field (moving the pointer there first). */
async function typeInto(page: Page, sel: string, text: string) {
  const loc = page.locator(sel);
  const box = await loc.boundingBox();
  if (box) await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 12 });
  await loc.click();
  await loc.pressSequentially(text, { delay: 45 });
  await sleep(page, 250);
}

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
  const box = await page.locator(".dash-map").boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 22 });
  await sleep(page, 400);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.locator(".game-card").waitFor({ timeout: 10000 });
  await sleep(page, 700);
}

// Each clip records in its own context so it gets its own video file.
async function clip(browser: Browser, name: string, storageState: string | undefined, flow: (page: Page) => Promise<void>) {
  const ctx = await browser.newContext({ viewport: VP, recordVideo: { dir: RAW, size: VP }, baseURL: BASE, storageState });
  await ctx.addInitScript(CURSOR_INIT);
  const page = await ctx.newPage();
  try {
    await flow(page);
    await sleep(page, 1200); // hold the final frame
  } finally {
    const video = page.video();
    await ctx.close();
    if (video) await video.saveAs(path.join(RAW, `${name}.webm`));
  }
  console.log(`  ✓ ${name}`);
}

async function main() {
  // Clean, lively base: a standing game at Zilker with a full roster + some
  // ambient interest so the map reads as an active area, not an empty one.
  await resetData();
  const game = await seedStandingGame({ ...SITE, regulars: 14, interested: 8 });

  // A signed-in demo user for the play-side flows. Registered once via the real
  // form, then reused via storageState so the clips start already on the map.
  const browser = await chromium.launch();
  const authCtx = await browser.newContext({ viewport: VP, baseURL: BASE });
  const authPage = await authCtx.newPage();
  await registerViaUi(authPage, { email: "" } as unknown as import("../e2e/steps/world").World, ALEX);
  await markEmailVerified(ALEX.email);
  const AUTH = path.join(process.cwd(), "tests/demos/.auth.json");
  await authCtx.storageState({ path: AUTH });
  await authCtx.close();

  console.log("recording clips…");

  // 1) Showing interest — a brand-new player signs up from the splash.
  await clip(browser, "show-interest", undefined, async (page) => {
    await page.goto("/");
    await sleep(page, 1400);
    await tap(page, { sel: 'a[href="/show-interest"]' });
    await page.waitForURL("**/show-interest");
    await sleep(page, 700);
    await typeInto(page, 'input[name="email"]', "riley@example.com");
    await typeInto(page, 'input[name="username"]', "Riley");
    await typeInto(page, 'input[name="password"]', "hunter2pass");
    await typeInto(page, 'input[name="zip"]', "78701");
    await sleep(page, 400);
    await Promise.all([page.waitForURL("**/play"), tap(page, { role: { name: "count me in" } })]);
    await page.locator(".map-legend").waitFor({ timeout: 15000 });
  });

  // 2) Joining a regular game — Alex (confirmed, not yet on the roster) joins.
  await pool.query(
    "DELETE FROM game_roster WHERE game_id = $1 AND user_id = (SELECT id FROM users WHERE lower(email)=lower($2))",
    [game.gameId, ALEX.email],
  );
  await clip(browser, "join-game", AUTH, async (page) => {
    await page.goto("/play");
    await openGame(page, game.lat, game.lng);
    await tap(page, { role: { name: "join game" } }, { pauseBefore: 550 });
    await page.locator(".game-leave").waitFor({ timeout: 10000 });
    await sleep(page, 600);
  });

  // 3) Attending a weekly game — a member says "i'm in" for the week.
  await seedRosterMember(game.gameId, ALEX.email, "out"); // start "out" so the tap is meaningful
  await clip(browser, "attend-week", AUTH, async (page) => {
    await page.goto("/play");
    await openGame(page, game.lat, game.lng);
    await tap(page, { role: { name: "i'm in" } }, { pauseBefore: 550 });
    await sleep(page, 900);
  });

  // 4) Pausing the series as captain — set an expected return + a note.
  await seedCaptain(game.areaId, ALEX.email);
  await clip(browser, "captain-pause", AUTH, async (page) => {
    await page.goto("/play");
    await openGame(page, game.lat, game.lng);
    await tap(page, { role: { name: "pause series" } }, { pauseBefore: 550 });
    await page.getByRole("alertdialog").waitFor({ timeout: 5000 });
    await sleep(page, 500);
    const dlg = page.getByRole("alertdialog");
    await dlg.locator('input[type="date"]').fill("2099-09-01");
    await sleep(page, 500);
    const note = dlg.locator("textarea");
    const nb = await note.boundingBox();
    if (nb) await page.mouse.move(nb.x + 20, nb.y + 16, { steps: 12 });
    await note.click();
    await note.pressSequentially("summer break — back in september", { delay: 40 });
    await sleep(page, 500);
    // Confirm inside the dialog — there's also a "pause series" control behind it.
    await tapLoc(page, dlg.getByRole("button", { name: "pause series", exact: true }), { pauseBefore: 550 });
    await page.locator(".game-paused").waitFor({ timeout: 10000 });
    await sleep(page, 700);
  });

  await browser.close();
  await pool.end();
  console.log("done — raw webms in tests/demos/raw/");
}

await main();
