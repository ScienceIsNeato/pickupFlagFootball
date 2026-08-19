// Sentry init for edge features (middleware, edge routes). Required even when
// running locally. https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from "@sentry/nextjs";

const SENTRY_ENV = process.env.SENTRY_ENVIRONMENT ?? process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "local";

Sentry.init({
  // Silent in e2e builds — see instrumentation-client.ts for the why.
  // A local `next dev` / `next start` inlines no environment, so the label falls
  // through to "local" — and a developer's laptop must not report into the same
  // feed as real users. Same reasoning as the e2e rule: the dashboard
  // is only worth having if everything in it came from someone real.
  enabled: SENTRY_ENV !== "local" && process.env.NEXT_PUBLIC_E2E !== "1",
  dsn: "https://ec97ba0ad8dd2fc1b5bb73d98fac0bb5@o4511528005533696.ingest.us.sentry.io/4511698052841472",
  // Edge runtime may not see the runtime SENTRY_ENVIRONMENT, so fall back to the
  // build-inlined NEXT_PUBLIC one (set per-env at build). Unset ⇒ a local run.
  environment: SENTRY_ENV,
  // Errors only for now (see sentry.server.config.ts).
  tracesSampleRate: 0,
});
