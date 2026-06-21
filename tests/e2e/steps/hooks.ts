import { Before, AfterStep } from "./world";
import { resetData } from "../support/db";
import { clearMailpit } from "../support/mailpit";

// Independent, deterministic scenarios: reset DB + inbox before each.
Before(async () => {
  await resetData();
  await clearMailpit();
});

// Capture a screenshot after every step — each Gherkin step is a story "beat",
// and these shots are what the visual report ties back to the stories.
AfterStep(async ({ page, $step, $testInfo }) => {
  try {
    if (!page || page.isClosed() || page.url() === "about:blank") return;
    const png = await page.screenshot();
    const title =
      typeof $step === "string"
        ? $step
        : ((($step as unknown) as { title?: string })?.title ?? "step");
    await $testInfo.attach(`beat:${title}`, { body: png, contentType: "image/png" });
  } catch {
    // best-effort: never fail a scenario over a missed screenshot
  }
});
