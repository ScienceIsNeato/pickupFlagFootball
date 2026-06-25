/** Fixed endpoints for the local e2e stack (see docker-compose.yml). High ports
 *  so they never clash with other dev stacks on this machine. */
export const E2E = {
  appPort: 3100,
  appBaseUrl: "http://127.0.0.1:3100",
  dbUrl: process.env.E2E_DB_URL ?? "postgres://mimeff:mimeff@127.0.0.1:55433/mimeff_test",
  smtpUrl: "smtp://127.0.0.1:11025",
  mailpitApi: "http://127.0.0.1:18025",
  // The app process runs with this secret (see playwright.config.ts webServer.env).
  // Tests reuse it to mint valid RSVP-link / decline-link tokens the app verifies.
  authSecret: "e2e-test-secret-not-for-prod",
  // The app process runs with this CRON_SECRET; tests send it as the Bearer to
  // drive the engine tick (/api/mime/tick), the same way Vercel Cron does.
  cronSecret: "e2e-cron-secret-not-for-prod",
  // Stripe: a dummy key (the webhook only needs it to construct the client; it
  // never calls the API) + a webhook secret tests sign events with. No
  // STRIPE_PRICE_ID, so the donate page stays on links (checkout isn't e2e'd —
  // it redirects off-site); only the webhook → status sync is.
  stripeSecretKey: "sk_test_e2e_dummy_not_for_prod",
  stripeWebhookSecret: "whsec_e2e_test_not_for_prod",
};
