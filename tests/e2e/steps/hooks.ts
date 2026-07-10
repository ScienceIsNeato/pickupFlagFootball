import { createHash } from "node:crypto";
import { Before, AfterStep } from "./world";
import { resetData } from "../support/db";
import { clearMailpit, freshEmails, inboxHtml } from "../support/mailpit";

// Per-test state (keyed by testId).
const lastShotHash = new Map<string, string>(); // dedupe identical back-to-back shots
const seenEmailIds = new Map<string, Set<string>>(); // emails already captured

// The report shows every step in two clients side by side WITHOUT running the
// suite twice: each beat is shot at the current (desktop) size, then the page is
// resized to a phone and shot again, then restored. Width-based media queries
// re-render on resize, so the mobile shot is the real responsive layout. Actual
// phone-only behaviour (touch, dpr) is covered separately by the @mobile project.
const MOBILE_VP = { width: 393, height: 851 }; // Pixel 5 CSS viewport

// Independent, deterministic scenarios: reset DB + inbox before each. Also clear the
// module-scoped capture caches — a reused worker carries them across scenarios, so
// stale dedupe state would suppress a legit beat and the maps would grow all run.
Before(async () => {
  await resetData();
  await clearMailpit();
  lastShotHash.clear();
  seenEmailIds.clear();
});

function stepTitle($step: unknown): string {
  return typeof $step === "string" ? $step : (($step as { title?: string })?.title ?? "step");
}

// Each Gherkin step is a story "beat". Two rules keep the visual report honest:
//   1. Only attach a screenshot when the view actually CHANGED — a step whose shot
//      is identical to the previous one (backend-only steps: DB seeds, engine ticks)
//      adds no beat, so the report shows change, not noise.
//   2. Any email a step caused is captured as its own beat (rendered from Mailpit),
//      so every email in a flow shows up — automatically, across all scenarios.
AfterStep(async ({ page, $step, $testInfo, world }) => {
  // The @mobile project is a real-phone pass/fail regression net, not a report
  // source — it drives the same steps on a touch device but attaches no beats.
  if ($testInfo.project.name === "mobile") return;

  const id = $testInfo.testId;
  const title = stepTitle($step);

  // (1) Deduped screenshot — the whole page, or just the scenario's "beat
  // lens" element when one is set (stories about a single widget). A lens
  // that isn't on screen yet (e.g. setup steps before the widget's page)
  // simply times out into the catch and contributes no beat. When the view
  // changed, the SAME step is also shot at phone width so the report can put
  // the two clients side by side (see MOBILE_VP).
  try {
    if (page && !page.isClosed() && page.url() !== "about:blank") {
      const shoot = () =>
        world.beatLens
          ? page.locator(world.beatLens).screenshot({ type: "jpeg", quality: 72, timeout: 2_000 })
          : page.screenshot({ type: "jpeg", quality: 72 });
      const shot = await shoot();
      const hash = createHash("sha1").update(shot).digest("hex");
      if (lastShotHash.get(id) !== hash) {
        lastShotHash.set(id, hash);
        await $testInfo.attach(`beat:d:${title}`, { body: shot, contentType: "image/jpeg" });
        // Same step, phone width. Resize, let layout (and the map's canvas)
        // settle, shoot, then restore so the next step runs at desktop size.
        const vp = page.viewportSize();
        try {
          await page.setViewportSize(MOBILE_VP);
          await page.waitForTimeout(150);
          const mshot = await shoot();
          await $testInfo.attach(`beat:m:${title}`, { body: mshot, contentType: "image/jpeg" });
        } catch {
          // best-effort: a missing mobile shot just leaves that column blank
        } finally {
          if (vp) {
            try {
              await page.setViewportSize(vp);
              await page.waitForTimeout(30);
            } catch {
              /* ignore restore failure */
            }
          }
        }
      }
    }
  } catch {
    // best-effort: never fail a scenario over a missed screenshot
  }

  // (2) New emails this step produced → render the inbox into a scratch page and
  //     attach as its own beat (doesn't disturb the app page under test).
  //     Skipped when a beat lens is set: that story is about one widget only,
  //     so a full-page inbox beat would break the "HUD-only" report.
  try {
    if (page && !page.isClosed() && !world.beatLens) {
      let seen = seenEmailIds.get(id);
      if (!seen) { seen = new Set(); seenEmailIds.set(id, seen); }
      const fresh = await freshEmails(seen);
      if (fresh.length) {
        const scratch = await page.context().newPage();
        try {
          await scratch.setContent(inboxHtml(fresh, `emails sent · ${title}`));
          const eshot = await scratch.screenshot({ type: "jpeg", quality: 72, fullPage: true });
          // Email beats are viewport-independent (a rendered inbox), so they
          // span both client columns in the report rather than pairing.
          await $testInfo.attach(`beat:full:📬 emails — ${title}`, { body: eshot, contentType: "image/jpeg" });
        } finally {
          await scratch.close();
        }
      }
    }
  } catch {
    // best-effort
  }
});
