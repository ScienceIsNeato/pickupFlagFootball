// Sentry init for edge features (middleware, edge routes). Required even when
// running locally. https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // Silent in e2e builds — see instrumentation-client.ts for the why.
  enabled: process.env.NEXT_PUBLIC_E2E !== "1",
  dsn: "https://ec97ba0ad8dd2fc1b5bb73d98fac0bb5@o4511528005533696.ingest.us.sentry.io/4511698052841472",
  // Edge runtime may not see the runtime SENTRY_ENVIRONMENT, so fall back to the
  // build-inlined NEXT_PUBLIC one (set per-env at build). Unset ⇒ a local run.
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "local",
  // Errors only for now (see sentry.server.config.ts).
  tracesSampleRate: 0,
});
