// Client-side Sentry init (runs whenever a page loads in the browser).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://ec97ba0ad8dd2fc1b5bb73d98fac0bb5@o4511528005533696.ingest.us.sentry.io/4511698052841472",
  // Client env label is inlined at build time (per-env Docker build), since the
  // browser has no runtime env — keeps dev/prod browser events labeled too.
  // A local `next dev`/`next start` build inlines nothing, so tag it "local".
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "local",
  // Errors only for now — no performance tracing and no session replay (both
  // eat the free tier fast). Add them back with sensible sample rates when
  // there's traffic worth the volume.
  tracesSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
