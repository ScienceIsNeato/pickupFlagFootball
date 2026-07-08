import * as Sentry from "@sentry/nextjs";

/**
 * Server-side error tracking. Follows the house env seam pattern
 * (BREVO_API_KEY et al.): SENTRY_DSN unset → Sentry.init never runs and the
 * whole layer is a no-op, so dev / CI / e2e report nothing and need no config.
 * Set the `pff-sentry-dsn` secret (DEPLOY.md) to turn it on in prod.
 */
const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "production",
    // Errors only for now — no performance tracing until there's traffic worth
    // sampling (keeps us square within the free tier).
    tracesSampleRate: 0,
  });
}
