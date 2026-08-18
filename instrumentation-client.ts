// Client-side Sentry init (runs whenever a page loads in the browser).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from "@sentry/nextjs";

const SENTRY_ENV = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "local";

Sentry.init({
  // e2e builds (NEXT_PUBLIC_E2E=1, inlined at build time) must NOT report:
  // CI test runs were flooding Sentry with synthetic errors indistinguishable
  // from real ones (213 "code 4" events in one debugging week, all from CI).
  // Tests exercise error paths on purpose — that's signal for CI logs, not Sentry.
  // A local `next dev` / `next start` inlines no environment, so the label falls
  // through to "local" — and a developer's laptop must not report into the same
  // feed as real users. Same reasoning as the e2e rule: the dashboard
  // is only worth having if everything in it came from someone real.
  enabled: SENTRY_ENV !== "local" && process.env.NEXT_PUBLIC_E2E !== "1",
  dsn: "https://ec97ba0ad8dd2fc1b5bb73d98fac0bb5@o4511528005533696.ingest.us.sentry.io/4511698052841472",
  // Client env label is inlined at build time (per-env Docker build), since the
  // browser has no runtime env — keeps dev/prod browser events labeled too.
  // A local `next dev`/`next start` build inlines nothing, so tag it "local".
  environment: SENTRY_ENV,
  // Errors only for now — no performance tracing and no session replay (both
  // eat the free tier fast). Add them back with sensible sample rates when
  // there's traffic worth the volume.
  tracesSampleRate: 0,
  integrations: [
    // Drop errors whose stacks contain NONE of our code. Real visitors arrive in
    // app webviews (Instagram/Facebook in-app browsers) and with extensions that
    // inject scripts; their crashes (e.g. the Meta bridge's logLoginFormFocused →
    // postMessage InvalidAccessError) surface as unhandled rejections we can't
    // fix. Our bundles are stamped via next.config's `applicationKey`; an event
    // with zero stamped frames is someone else's bug. The "exclusively" behaviour
    // keeps anything that touches our code even partially.
    Sentry.thirdPartyErrorFilterIntegration({
      filterKeys: ["mime-ff"],
      behaviour: "drop-error-if-exclusively-contains-third-party-frames",
    }),
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
