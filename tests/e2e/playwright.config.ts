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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${E2E.appPort}`,
    url: E2E.appBaseUrl,
    cwd: process.cwd(), // run from repo root, not the config's dir (where .next isn't)
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E.dbUrl,
      DATABASE_DRIVER: "node-postgres",
      EMAIL_TRANSPORT: "smtp",
      SMTP_URL: E2E.smtpUrl,
      APP_BASE_URL: E2E.appBaseUrl,
      AUTH_SECRET: "e2e-test-secret-not-for-prod",
      AUTH_URL: E2E.appBaseUrl,
      AUTH_TRUST_HOST: "true",
      NEXTAUTH_SECRET: "e2e-test-secret-not-for-prod",
      NEXTAUTH_URL: E2E.appBaseUrl,
      // dummy Google creds so the auth provider config doesn't choke at boot
      GOOGLE_CLIENT_ID: "e2e-google-id",
      GOOGLE_CLIENT_SECRET: "e2e-google-secret",
    },
  },
});
