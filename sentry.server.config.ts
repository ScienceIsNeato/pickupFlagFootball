// Server-side Sentry init (runs whenever the server handles a request).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://ec97ba0ad8dd2fc1b5bb73d98fac0bb5@o4511528005533696.ingest.us.sentry.io/4511698052841472",
  // dev vs production share one Sentry project — label events so incidents
  // don't mix (set per Cloud Run service via SENTRY_ENVIRONMENT in the deploy).
  environment: process.env.SENTRY_ENVIRONMENT,
  // Errors only for now — no performance tracing (keeps us in the free tier).
  // Bump this or add tracesSampler once there's traffic worth sampling.
  tracesSampleRate: 0,
});
