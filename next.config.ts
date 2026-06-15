import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load the DB drivers from node_modules at runtime instead of bundling them
  // into webpack vendor chunks. Avoids the intermittent dev-server
  // "Cannot find module './vendor-chunks/drizzle-orm.js'" corruption.
  serverExternalPackages: ["drizzle-orm", "@neondatabase/serverless"],
};

export default nextConfig;
