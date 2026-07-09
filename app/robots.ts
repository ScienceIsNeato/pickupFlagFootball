import type { MetadataRoute } from "next";

// Read APP_BASE_URL at request time (Cloud Run runtime env), not build time —
// the Docker build has no APP_BASE_URL, so a static render would bake the
// fallback for every environment.
export const dynamic = "force-dynamic";

const APP_BASE_URL = () => process.env.APP_BASE_URL?.trim() || "https://pickupflagfootball.com";

/** Crawl guidance: index the public marketing pages, keep bots out of the API
 *  and the auth-gated app routes (nothing there is useful to a crawler). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/play", "/my-games", "/account"],
    },
    sitemap: `${APP_BASE_URL()}/sitemap.xml`,
  };
}
