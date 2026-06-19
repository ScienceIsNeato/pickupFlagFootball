import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Load the DB drivers from node_modules at runtime instead of bundling them
  // into webpack vendor chunks. Avoids the intermittent dev-server
  // "Cannot find module './vendor-chunks/drizzle-orm.js'" corruption.
  serverExternalPackages: ["drizzle-orm", "@neondatabase/serverless"],
  // the map page was renamed /dashboard → /play; keep old links working
  async redirects() {
    return [{ source: "/dashboard", destination: "/play", permanent: true }];
  },
};

export default nextConfig;
