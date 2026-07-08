import * as Sentry from "@sentry/nextjs";

// Edge-runtime twin of sentry.server.config.ts (middleware.ts runs on the edge
// runtime in the build even though we deploy to Cloud Run). Same seam: no
// SENTRY_DSN → no-op.
const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "production",
    tracesSampleRate: 0,
  });
}
