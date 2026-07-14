import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { E2E } from "./support/env";

// Globs are resolved relative to this config file's directory (tests/e2e).
const testDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: "steps/**/*.ts",
  outputDir: ".features-gen",
});

export default defineConfig({
  testDir,
  // Shared DB reset per scenario → must run serially (no cross-scenario clobber).
  workers: 1,
  fullyParallel: false,
  // Retry in CI only: the mobile (Pixel 5) project is timing-sensitive on shared
  // runners and flakes intermittently, which — with no retries — was red-lining
  // the prod deploy on a single flaky test. Locally keep 0 so real failures surface.
  retries: process.env.CI ? 2 : 0,
  // Paths below are resolved relative to this config's dir (tests/e2e).
  outputDir: "test-results",
  reporter: [
    ["list"],
    ["./report/reporter.ts"], // visual story report: beats → screenshots
    ["html", { outputFolder: ".playwright-report", open: "never" }],
  ],
  use: {
    baseURL: E2E.appBaseUrl,
    screenshot: "off", // we take per-beat screenshots ourselves
    trace: "retain-on-failure",
  },
  // "desktop" runs the whole suite ONCE; its report shows every beat at desktop
  // and phone width side by side (the hook resizes per beat — see steps/hooks.ts),
  // so there are no duplicate tests. "mobile" re-runs only the @mobile-tagged
  // map/HUD scenarios on a real phone profile (touch, dpr) as a regression net
  // for behaviour a resize alone can't exercise. Serial (workers:1) so the two
  // projects don't clobber the shared DB.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The Pixel 5 profile (dpr 2.75, canvas + maplibre) is CPU-heavy: these same
    // map/HUD scenarios finish in ~2s locally but hang out to the 30s limit on
    // GitHub's 2-core runners, red-lining the deploy. Give the mobile project a
    // roomier per-test budget in CI only — locally keep 30s so real slowness
    // still surfaces. (This grants time; it does not skip or soften any assertion.)
    { name: "mobile", use: { ...devices["Pixel 5"] }, grep: /@mobile/, timeout: process.env.CI ? 90_000 : 30_000 },
  ],
  webServer: {
    command: `npx next start -p ${E2E.appPort}`,
    url: E2E.appBaseUrl,
    cwd: process.cwd(), // run from repo root, not the config's dir (where .next isn't)
    // Always start our own server so it carries the pinned e2e env below — never
    // reuse a stray process that might point at prod DB/email. run.sh frees the
    // port first so this doesn't collide.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E.dbUrl,
      DATABASE_DRIVER: "node-postgres",
      EMAIL_TRANSPORT: "smtp",
      SMTP_URL: E2E.smtpUrl,
      APP_BASE_URL: E2E.appBaseUrl,
      AUTH_SECRET: E2E.authSecret,
      AUTH_URL: E2E.appBaseUrl,
      AUTH_TRUST_HOST: "true",
      NEXTAUTH_SECRET: E2E.authSecret,
      NEXTAUTH_URL: E2E.appBaseUrl,
      // dummy Google creds so the auth provider config doesn't choke at boot
      GOOGLE_CLIENT_ID: "e2e-google-id",
      GOOGLE_CLIENT_SECRET: "e2e-google-secret",
      // lets the FSM e2e drive /api/mime/tick (Bearer CRON_SECRET), like Vercel Cron
      CRON_SECRET: E2E.cronSecret,
      // lets the donation webhook verify signed test events (no STRIPE_PRICE_ID,
      // so the donate page stays on links — checkout isn't e2e'd)
      STRIPE_SECRET_KEY: E2E.stripeSecretKey,
      STRIPE_WEBHOOK_SECRET: E2E.stripeWebhookSecret,
    },
  },
});
