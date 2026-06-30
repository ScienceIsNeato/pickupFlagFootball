import { createHash } from "node:crypto";
import { Before, AfterStep } from "./world";
import { resetData } from "../support/db";
import { clearMailpit, freshEmails, inboxHtml } from "../support/mailpit";

// Independent, deterministic scenarios: reset DB + inbox before each.
Before(async () => {
  await resetData();
  await clearMailpit();
});

// Per-test state (keyed by testId).
const lastShotHash = new Map<string, string>(); // dedupe identical back-to-back shots
const seenEmailIds = new Map<string, Set<string>>(); // emails already captured

function stepTitle($step: unknown): string {
  return typeof $step === "string" ? $step : (($step as { title?: string })?.title ?? "step");
}

// Each Gherkin step is a story "beat". Two rules keep the visual report honest:
//   1. Only attach a screenshot when the view actually CHANGED — a step whose shot
//      is identical to the previous one (backend-only steps: DB seeds, engine ticks)
//      adds no beat, so the report shows change, not noise.
//   2. Any email a step caused is captured as its own beat (rendered from Mailpit),
//      so every email in a flow shows up — automatically, across all scenarios.
AfterStep(async ({ page, $step, $testInfo }) => {
  const id = $testInfo.testId;
  const title = stepTitle($step);

  // (1) Deduped page screenshot.
  try {
    if (page && !page.isClosed() && page.url() !== "about:blank") {
      const shot = await page.screenshot({ type: "jpeg", quality: 72 });
      const hash = createHash("sha1").update(shot).digest("hex");
      if (lastShotHash.get(id) !== hash) {
        lastShotHash.set(id, hash);
        await $testInfo.attach(`beat:${title}`, { body: shot, contentType: "image/jpeg" });
      }
    }
  } catch {
    // best-effort: never fail a scenario over a missed screenshot
  }

  // (2) New emails this step produced → render the inbox into a scratch page and
  //     attach as its own beat (doesn't disturb the app page under test).
  try {
    if (page && !page.isClosed()) {
      let seen = seenEmailIds.get(id);
      if (!seen) { seen = new Set(); seenEmailIds.set(id, seen); }
      const fresh = await freshEmails(seen);
      if (fresh.length) {
        const scratch = await page.context().newPage();
        try {
          await scratch.setContent(inboxHtml(fresh, `emails sent · ${title}`));
          const eshot = await scratch.screenshot({ type: "jpeg", quality: 72, fullPage: true });
          await $testInfo.attach(`beat:📬 emails — ${title}`, { body: eshot, contentType: "image/jpeg" });
        } finally {
          await scratch.close();
        }
      }
    }
  } catch {
    // best-effort
  }
});
