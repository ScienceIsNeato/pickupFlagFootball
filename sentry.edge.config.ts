// Sentry init for edge features (middleware, edge routes). Required even when
// running locally. https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://ec97ba0ad8dd2fc1b5bb73d98fac0bb5@o4511528005533696.ingest.us.sentry.io/4511698052841472",
  // Edge runtime may not see the runtime SENTRY_ENVIRONMENT, so fall back to the
  // build-inlined NEXT_PUBLIC one (set per-env at build).
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  // Errors only for now (see sentry.server.config.ts).
  tracesSampleRate: 0,
});
