// Server-side Sentry init (runs whenever the server handles a request).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
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
  // dev vs production share one Sentry project — label events so incidents
  // don't mix (set per Cloud Run service via SENTRY_ENVIRONMENT in the deploy;
  // NEXT_PUBLIC fallback covers the build-inlined value). Deploys always set one
  // of these, so an unset value means a local run — tag it "local" so it's
  // filterable and never masquerades as production.
  environment: SENTRY_ENV,
  // Errors only for now — no performance tracing (keeps us in the free tier).
  // Bump this or add tracesSampler once there's traffic worth sampling.
  tracesSampleRate: 0,
});
