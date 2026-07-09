import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle (.next/standalone/server.js) for the Cloud Run
  // Docker image — ships a pruned node_modules so the runtime stage stays small.
  output: "standalone",
  // Load the DB drivers from node_modules at runtime instead of bundling them
  // into webpack vendor chunks. Avoids the intermittent dev-server
  // "Cannot find module './vendor-chunks/drizzle-orm.js'" corruption.
  serverExternalPackages: ["drizzle-orm", "@neondatabase/serverless"],
  // the map page was renamed /dashboard → /play; keep old links working
  async redirects() {
    return [{ source: "/dashboard", destination: "/play", permanent: true }];
  },
};

// Sentry build wrapper: uploads source maps so stack traces map to TS source.
// Upload only happens when SENTRY_AUTH_TOKEN is present (locally via the
// gitignored .env.sentry-build-plugin; in CI via the token pulled from Secret
// Manager and mounted into the Docker build). Without the token the build still
// succeeds — it just skips the upload.
export default withSentryConfig(nextConfig, {
  org: "william-martin-11",
  project: "mime-ff",
  // Quiet locally; verbose in CI so an upload problem is visible in the logs.
  silent: !process.env.CI,
  // Upload the wider client source-map set for prettier browser stack traces.
  widenClientFileUpload: true,
  webpack: {
    // Tree-shake Sentry's debug logging out of the bundle.
    treeshake: { removeDebugLogging: true },
    // (automaticVercelMonitors dropped — this deploys to Cloud Run, not Vercel.)
  },
});
