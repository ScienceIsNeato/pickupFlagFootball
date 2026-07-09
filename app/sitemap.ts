import type { MetadataRoute } from "next";

// Read APP_BASE_URL at request time (Cloud Run runtime), not the build fallback.
export const dynamic = "force-dynamic";

/** The public, crawlable pages. The app routes (/play, /my-games, /account) are
 *  auth-gated and intentionally excluded. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_BASE_URL?.trim() || "https://pickupflagfootball.com";
  const paths = ["", "/show-interest", "/faq", "/donate", "/privacy", "/terms"];
  return paths.map((p) => ({
    url: `${base}${p || "/"}`,
    changeFrequency: "weekly",
    priority: p === "" ? 1 : 0.6,
  }));
}
