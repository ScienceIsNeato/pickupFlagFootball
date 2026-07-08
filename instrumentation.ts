import * as Sentry from "@sentry/nextjs";

/**
 * Next.js instrumentation hook (loaded once per server start). Wires Sentry
 * error tracking for the server and edge runtimes; everything no-ops unless
 * SENTRY_DSN is set (see sentry.server.config.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors from App Router request handling (server components, server
// actions, route handlers) — the main "did prod just break" signal.
export const onRequestError = Sentry.captureRequestError;
