/**
 * Captures the mobile states the original audit sweep never reached (the
 * "what this audit did not cover" list): email-token landing pages, the
 * password-reset flow, error/validation states, captain view, empty areas,
 * 404s, non-map landscape, and a rendered email at phone width.
 *
 * Run like tests/demos/shots.mts (e2e stack up, app on :3100 with the e2e
 * env). Screenshots land in $GAP_OUT (default /tmp/gap-captures).
 */
import { chromium, type Page, type Browser } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2E } from "../e2e/support/env";
import {
  resetData, seedStandingGame, markEmailVerified, seedCaptain, proposeAsUser,
} from "../e2e/support/db";
import { registerViaUi } from "../e2e/support/flows";
import { allEmails, clearMailpit } from "../e2e/support/mailpit";

const BASE = E2E.appBaseUrl;
const OUT = process.env.GAP_OUT || "/tmp/gap-captures";
mkdirSync(OUT, { recursive: true });

const GALE = { name: "Gap Gale", email: "gale@example.com", zip: "78701" };
const PROPOSER = { name: "Petra Propose", email: "petra@example.com", zip: "78613" };
const SITE = { lat: 30.5052, lng: -97.8203, placeText: "Cedar Park Field", city: "Cedar Park", zip: "78613" };
const GAME_SITE = { lat: 30.2669, lng: -97.7729, placeText: "Zilker Park", city: "Austin", zip: "78701" };
// A second seeded catchment with no game (Cedar Park; used by e2e as "FAR").
const EMPTY = { name: "Faraway Fran", email: "fran@example.com", zip: "78613" };

const misses: string[] = [];

async function tick(page: Page) {
  const r = await page.request.post(`${BASE}/api/mime/tick`, { headers: { authorization: "Bearer demo" } });
  if (!r.ok()) misses.push(`tick returned ${r.status()}`);
}

/** First href in an email body matching `pat`, across all mails to `to` (a
 *  string address or a regex - proposal mail goes to the seeded cohort). */
async function linkFromEmail(to: string | RegExp, subjectPat: RegExp, hrefPat: RegExp): Promise<string | null> {
  const mails = await allEmails();
  for (const m of mails) {
    const toOk = typeof to === "string" ? m.to.toLowerCase() === to.toLowerCase() : to.test(m.to);
    if (!toOk || !subjectPat.test(m.subject)) continue;
    const match = m.html?.match(new RegExp(`href="([^"]*${hrefPat.source}[^"]*)"`, "i"));
    if (match) return match[1].replace(/&amp;/g, "&");
  }
  return null;
}

async function cap(browser: Browser, name: string, fn: (page: Page) => Promise<void>,
  opts: { viewport?: { width: number; height: number }; storageState?: string } = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 375, height: 812 },
    deviceScaleFactor: 2, hasTouch: true, isMobile: true, baseURL: BASE,
    storageState: opts.storageState,
  });
  const page = await ctx.newPage();
  try {
    await fn(page);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    misses.push(`${name}: ${(e as Error).message.split("\n")[0]}`);
    await page.screenshot({ path: path.join(OUT, `${name}-FAILED.png`) }).catch(() => {});
    console.log(`  ✗ ${name}`);
  } finally {
    await ctx.close();
  }
}

async function main() {
  await resetData();
  await clearMailpit();
  const game = await seedStandingGame({ ...GAME_SITE, regulars: 12, interested: 6 });

  const browser = await chromium.launch();
  const AUTH = path.join(process.cwd(), "tests/demos/.gap-auth.json");
  try {
    // Register Gale via the real UI (leaves the confirm email in Mailpit).
    const regCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, baseURL: BASE });
    const regPage = await regCtx.newPage();
    await registerViaUi(regPage, { email: "" } as unknown as import("../e2e/steps/world").World, GALE);
    await regCtx.storageState({ path: AUTH });
    await regCtx.close();

    // Unverified banner over the map (chips + banner sharing the top strip).
    await cap(browser, "unverified-banner-map", async (p) => {
      await p.goto("/play", { waitUntil: "domcontentloaded" });
      await p.locator(".unverified-banner").waitFor({ timeout: 10000 });
      await p.waitForTimeout(1500);
    }, { storageState: AUTH });

    // The confirm email itself, rendered at phone width.
    const mails = await allEmails();
    const confirm = mails.find((m) => m.to.toLowerCase() === GALE.email && /confirm/i.test(m.subject));
    if (confirm?.html) {
      const f = path.join(OUT, "_email.html");
      writeFileSync(f, confirm.html);
      await cap(browser, "email-confirm-render", async (p) => { await p.goto(`file://${f}`); });
    } else misses.push("confirm email not found in mailpit");

    // Verify-email: the real link, then a bogus token.
    const verifyUrl = await linkFromEmail(GALE.email, /confirm/i, /verify-email/);
    if (verifyUrl) {
      await cap(browser, "verify-email-valid", async (p) => { await p.goto(verifyUrl); await p.waitForTimeout(600); });
    } else misses.push("verify-email link not found");
    await cap(browser, "verify-email-invalid", async (p) => { await p.goto("/verify-email?token=bogus"); });
    await markEmailVerified(GALE.email); // belt and braces for the later states

    // Auth + registration error states.
    await cap(browser, "auth-wrong-password", async (p) => {
      await p.goto("/?signin=1");
      await p.fill('.auth-card input[type="email"]', GALE.email);
      await p.fill('.auth-card input[type="password"]', "wrong-password");
      await p.click(".auth-card button[type=submit]");
      await p.locator(".auth-error").waitFor({ timeout: 10000 });
    });
    await cap(browser, "register-duplicate-email", async (p) => {
      await p.goto("/show-interest");
      await p.fill(".addr-finder input", GALE.zip);
      await p.locator(".addr-result").first().click();
      await p.fill('input[name="email"]', GALE.email);
      await p.fill('input[name="username"]', "Gale Again");
      await p.fill('input[name="password"]', "password123");
      await p.getByRole("button", { name: "count me in" }).click();
      await p.locator(".auth-error").waitFor({ timeout: 10000 });
    });

    // Password reset: form, sent state, valid link, invalid token.
    await cap(browser, "forgot-password", async (p) => { await p.goto("/forgot-password"); });
    await cap(browser, "forgot-password-sent", async (p) => {
      await p.goto("/forgot-password");
      await p.fill('input[type="email"]', GALE.email);
      await p.getByRole("button", { name: /send|reset/i }).click();
      await p.waitForTimeout(1200);
    });
    const resetUrl = await linkFromEmail(GALE.email, /reset/i, /reset-password/);
    if (resetUrl) {
      await cap(browser, "reset-password-valid", async (p) => { await p.goto(resetUrl); });
    } else misses.push("reset link not found");
    await cap(browser, "reset-password-invalid", async (p) => { await p.goto("/reset-password?token=bogus"); });

    // Account: bad-zip validation error + the change-email pane.
    await cap(browser, "account-bad-zip", async (p) => {
      await p.goto("/account");
      await p.fill('input[name="zip"]', "00000"); // passes the pattern, fails the geocode
      await p.getByRole("button", { name: "Save Changes" }).click();
      await p.locator(".acct-save-err").waitFor({ timeout: 10000 });
    }, { storageState: AUTH });
    await cap(browser, "account-change-email", async (p) => {
      await p.goto("/account");
      const t = p.locator("button.auth-link", { hasText: "change email" });
      await t.waitFor({ timeout: 10000 });
      await t.click({ timeout: 5000 }).catch(() => t.click({ force: true }));
      await p.locator(".acct-email-form").waitFor({ timeout: 5000 });
    }, { storageState: AUTH });

    // Captain view of the game page.
    await seedCaptain(game.areaId, GALE.email);
    await cap(browser, "captain-game-page", async (p) => {
      await p.goto(`/game/${game.gameId}`, { waitUntil: "domcontentloaded" });
      await p.locator(".game-captain").first().waitFor({ timeout: 10000 });
    }, { storageState: AUTH });

    // Empty-area map: a confirmed player where no game exists.
    const franCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, baseURL: BASE });
    const franPage = await franCtx.newPage();
    await registerViaUi(franPage, { email: "" } as unknown as import("../e2e/steps/world").World, EMPTY);
    await markEmailVerified(EMPTY.email);
    const FRAN_AUTH = path.join(process.cwd(), "tests/demos/.gap-auth-fran.json");
    await franCtx.storageState({ path: FRAN_AUTH });
    await franCtx.close();
    await cap(browser, "empty-area-map", async (p) => {
      await p.goto("/play", { waitUntil: "domcontentloaded" });
      await p.reload({ waitUntil: "domcontentloaded" }); // banner gone after verify
      await p.locator("canvas.maplibregl-canvas").waitFor({ timeout: 15000 });
      await p.waitForTimeout(2000);
    }, { storageState: FRAN_AUTH });

    // Proposal emails → interested / decline / unsubscribe landing pages.
    const pCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, baseURL: BASE });
    const pPage = await pCtx.newPage();
    await registerViaUi(pPage, { email: "" } as unknown as import("../e2e/steps/world").World, PROPOSER);
    await markEmailVerified(PROPOSER.email);
    await proposeAsUser(PROPOSER.email, SITE);
    await tick(pPage);
    await pCtx.close();
    for (const [name, pat] of [["interested", /\/interested\?/], ["decline", /\/decline\?/], ["unsubscribe", /\/unsubscribe\?/]] as const) {
      // proposeAsUser snapshots its own synthetic cohort - their mail carries the links
      const url = await linkFromEmail(/^seed-.*-neighbor/, /proposed near you/i, pat);
      if (url) await cap(browser, `landing-${name}`, async (p) => { await p.goto(url); });
      else misses.push(`${name} link not found in proposal email`);
    }
    await cap(browser, "landing-rsvp-invalid", async (p) => { await p.goto("/rsvp?token=bogus"); });

    // 404s: marketing and an app-side missing game.
    await cap(browser, "not-found", async (p) => { await p.goto("/this-page-does-not-exist"); });
    await cap(browser, "game-not-found", async (p) => {
      await p.goto("/game/00000000-0000-4000-8000-000000000000", { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(1200);
    }, { storageState: AUTH });

    // Non-map landscape.
    const LS = { viewport: { width: 812, height: 375 } };
    await cap(browser, "landscape-game-page", async (p) => {
      await p.goto(`/game/${game.gameId}`, { waitUntil: "domcontentloaded" });
      await p.locator(".game-dl").waitFor({ timeout: 10000 });
    }, { ...LS, storageState: AUTH });
    await cap(browser, "landscape-account", async (p) => { await p.goto("/account"); }, { ...LS, storageState: AUTH });
    await cap(browser, "landscape-splash", async (p) => { await p.goto("/"); await p.waitForTimeout(800); }, LS);
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(misses.length ? `MISSES:\n- ${misses.join("\n- ")}` : "all states captured");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
