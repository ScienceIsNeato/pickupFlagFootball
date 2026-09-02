/**
 * Google Play listing screenshots.
 *
 * Same idea as shots.mts (real app, real seed, no mockups) but shot to Play's
 * spec rather than the splash gallery's: 1080×1920 PNG, which is 9:16 and well
 * inside Play's 2:1 aspect cap. The gallery's 390×780 stills are exactly 2:1 —
 * right at the limit, and too small to look sharp on a store page.
 *
 * Run via scripts/shoot_play_store.sh (brings up the stack, seeds, starts the app).
 * Output: store/play/screenshots/*.png — upload these to Play Console.
 */
import { chromium, type Page, type Browser } from "@playwright/test";
import { Pool } from "pg";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { E2E } from "../e2e/support/env";
import {
  resetData, seedStandingGame, markEmailVerified, seedRosterMember,
  seedChatMessageFromOther, seedPlayedWeeks, proposeAsUser, seedInterested,
} from "../e2e/support/db";
import { registerViaUi } from "../e2e/support/flows";

const BASE = E2E.appBaseUrl;
// 360×640 at dsf 3 = 1080×1920: Play's recommended phone size, and a real
// phone's CSS width, so the layout is the one an actual user sees.
const VP = { width: 360, height: 640 };
const SCALE = 3;
const OUT = path.join(process.cwd(), "store/play/screenshots");
mkdirSync(OUT, { recursive: true });

const pool = new Pool({ connectionString: E2E.dbUrl });

const SITE = { lat: 30.2669, lng: -97.7729, placeText: "Zilker Park", city: "Austin", zip: "78701" };
// A second, nearby spot so the map has more than one thing happening on it.
const PROPOSED = { lat: 30.2849, lng: -97.7341, placeText: "Mueller Lake Park", city: "Austin", zip: "78723" };
const ALEX = { name: "Alex", email: "alex@example.com", zip: "78701" };
const PETRA = { name: "Petra", email: "petra-store@example.com", zip: "78701" };

const sleep = (p: Page, ms: number) => p.waitForTimeout(ms);
const misses: string[] = [];

async function centerOnGame(page: Page, lat: number, lng: number, zoom = 12) {
  await page.locator("canvas.maplibregl-canvas").waitFor({ timeout: 15000 });
  // Any /api/map response, not specifically res=7: the resolution the map asks
  // for depends on zoom, so pinning res=7 only works at the default zoom — and
  // even there it passes by racing the initial page load rather than observing
  // the jumpTo. Waiting on the feed generally is what we actually mean.
  const feed = page.waitForResponse((r) => r.url().includes("/api/map"), { timeout: 15000 });
  await page.evaluate(({ lat, lng, zoom }) => {
    (window as unknown as { __e2eMap?: { jumpTo: (o: unknown) => void } }).__e2eMap?.jumpTo({ center: [lng, lat], zoom });
  }, { lat, lng, zoom });
  await feed;
  await sleep(page, 1200); // let tiles + badge art settle before the shutter
}

async function openGame(page: Page, lat: number, lng: number) {
  await centerOnGame(page, lat, lng);
  const map = page.locator(".dash-map");
  await map.waitFor({ timeout: 10000 });
  const box = await map.boundingBox();
  if (!box) throw new Error("no box for .dash-map");
  // The badge pin's TIP anchors at the venue (= map centre); its visual centre
  // sits ~40px above, inside the hit radius.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 40);
  await page.locator(".game-card").waitFor({ timeout: 10000 });
  await sleep(page, 700);
}

async function shot(browser: Browser, name: string, storageState: string | undefined, flow: (page: Page) => Promise<void>) {
  const ctx = await browser.newContext({
    viewport: VP, deviceScaleFactor: SCALE, baseURL: BASE, storageState,
    isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  try {
    await flow(page);
    await page.mouse.move(4, 4); // no hover states in a still
    await sleep(page, 400);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    // One bad shot shouldn't cost the whole run — capture what went wrong and
    // keep going, then report at the end.
    misses.push(`${name}: ${(e as Error).message.split("\n")[0]}`);
    await page.screenshot({ path: path.join(OUT, `${name}-FAILED.png`) }).catch(() => {});
    console.log(`  ✗ ${name}`);
  } finally {
    await ctx.close();
  }
}

/** Give an attempt's seeded "interested" users real homes near the venue, plus an
 *  active interest signal in its cell — what the map counts for its badge. */
async function neighborsAround(
  attemptId: string, areaId: string, at: { lat: number; lng: number; zip: string },
) {
  const tag = attemptId.slice(0, 8);
  const { rows } = await pool.query(
    "SELECT id FROM users WHERE email LIKE $1 ORDER BY email",
    [`seed-${tag}-in%@example.com`],
  );
  const { rows: [act] } = await pool.query("SELECT id FROM activity_types WHERE slug = 'flag-football' LIMIT 1");
  const { rows: [area] } = await pool.query("SELECT h3_cell FROM areas WHERE id = $1", [areaId]);
  for (const [i, u] of rows.entries()) {
    const lat = at.lat + ((i % 3) - 1) * 0.005;
    const lng = at.lng + ((i % 4) - 1.5) * 0.005;
    await pool.query(
      "UPDATE users SET home_lat = $2, home_lng = $3, zip = $4 WHERE id = $1",
      [u.id, lat, lng, at.zip],
    );
    await pool.query(
      `INSERT INTO interest_signals (activity_type_id, user_id, area_id, h3_base, active)
       VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING`,
      [act.id, u.id, areaId, area.h3_cell],
    );
  }
}

async function main() {
  await resetData();
  const game = await seedStandingGame({ ...SITE, regulars: 14, interested: 8 });

  const browser = await chromium.launch();
  try {
    const authCtx = await browser.newContext({ viewport: VP, deviceScaleFactor: SCALE, baseURL: BASE });
    const authPage = await authCtx.newPage();
    await registerViaUi(authPage, { email: "" } as unknown as import("../e2e/steps/world").World, ALEX);
    await markEmailVerified(ALEX.email);
    const AUTH = path.join(process.cwd(), "tests/demos/.play-auth.json");
    await authCtx.storageState({ path: AUTH });
    await authCtx.close();

    // A live proposal nearby, mid-gathering, so the map shows both a running
    // game and one forming — that contrast is the actual product pitch.
    const petraCtx = await browser.newContext({ viewport: VP, baseURL: BASE });
    const petraPage = await petraCtx.newPage();
    await registerViaUi(petraPage, { email: "" } as unknown as import("../e2e/steps/world").World, PETRA);
    await markEmailVerified(PETRA.email);
    await petraCtx.close();
    const attempt = await proposeAsUser(PETRA.email, PROPOSED);
    await seedInterested(attempt.attemptId, 4);
    // seedInterested parks its users at 0,0 with no interest signal, so the map's
    // forming badge — which counts registered players' home cells, not proposal
    // responses — rendered "0 in" next to a card saying "5 so far". Truthful for
    // the seed, misleading as a picture of the product. Give them homes around
    // the proposed venue and a signal in its cell so the badge matches the card.
    await neighborsAround(attempt.attemptId, attempt.areaId, PROPOSED);

    console.log("capturing Play Store screenshots…");

    // 1) The map — the hero shot. Zoomed out enough to show a running game and
    //    a forming one at once.
    await shot(browser, "01-map", AUTH, async (page) => {
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      await centerOnGame(page, 30.2759, -97.7535, 11);
    });

    // 2) A game you can join.
    await pool.query(
      "DELETE FROM game_roster WHERE game_id = $1 AND user_id = (SELECT id FROM users WHERE lower(email)=lower($2))",
      [game.gameId, ALEX.email],
    );
    await shot(browser, "02-join-game", AUTH, async (page) => {
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      await openGame(page, game.lat, game.lng);
    });

    // 3) A game forming — the "propose it and see who's in" half of the product.
    await shot(browser, "03-proposed-game", AUTH, async (page) => {
      await page.goto(`/proposed?lat=${attempt.lat}&lng=${attempt.lng}`, { waitUntil: "domcontentloaded" });
      await page.locator(".game-card").waitFor({ timeout: 15000 });
      await sleep(page, 700);
    });

    // 4) Chat — two neighbours sorting out the ordinary stuff.
    await seedRosterMember(game.gameId, ALEX.email, "in");
    await seedChatMessageFromOther(game.gameId, "sam-demo@example.com", "Sam", "anyone bringing an extra set of flags?");
    await seedChatMessageFromOther(game.gameId, "riley-demo@example.com", "Riley", "got two sets + cones. front lot fills by noon fyi");
    await shot(browser, "04-game-chat", AUTH, async (page) => {
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      await openGame(page, game.lat, game.lng);
      await page.getByRole("tab", { name: "chat" }).click();
      await page.locator(".chat-thread").waitFor({ timeout: 10000 });
      await sleep(page, 600);
    });

    // 5) My games — upcoming weeks and the history that proves it's a habit.
    await seedPlayedWeeks(game.gameId, ALEX.email, 3);
    await shot(browser, "05-my-games", AUTH, async (page) => {
      await page.goto("/my-games", { waitUntil: "domcontentloaded" });
      await page.locator(".mine-panel, .mine-section").first().waitFor({ timeout: 10000 }).catch(() => {});
      await sleep(page, 700);
    });

    // 6) Signing up — one screen, ZIP only.
    await shot(browser, "06-sign-up", undefined, async (page) => {
      await page.goto("/show-interest");
      await page.locator('input[name="zip"]').waitFor({ timeout: 15000 });
      await page.fill('input[name="zip"]', "78701");
      await page.locator('[data-testid="zip-ok"]').waitFor({ timeout: 10000 });
      await page.fill('input[name="email"]', "riley@example.com");
      await page.fill('input[name="username"]', "Riley");
      await sleep(page, 400);
    });
  } finally {
    await browser.close().catch((e) => console.error("browser close failed:", e));
    await pool.end().catch((e) => console.error("pool end failed:", e));
  }
  console.log(misses.length ? `\nMISSES:\n- ${misses.join("\n- ")}` : `\nall shots captured → ${OUT}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
