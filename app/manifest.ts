import type { MetadataRoute } from "next";
import { skin } from "@/lib/skin";

/**
 * Web app manifest. Without this the browser offers no install at all — it is the
 * hard requirement behind the "install as an app" panel on the landing page.
 *
 * Chrome's criteria: short_name or name, a 192px AND a 512px icon, start_url, and a
 * standalone-ish display mode. The maskable icon is separate on purpose: Android
 * masks icons to a circle and would clip a full-bleed badge, so that variant is the
 * same art padded onto the app background.
 * https://web.dev/articles/install-criteria
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${skin.brandName} · ${skin.seo.title.split("·").slice(1).join("·").trim() || "pickup flag football"}`,
    short_name: skin.brandName,
    description: skin.seo.description,
    // Installed users open straight to the map, not the marketing splash — they've
    // already been sold.
    start_url: "/play",
    scope: "/",
    display: "standalone",
    // Match the real chrome-bar color (also the viewport themeColor) so the
    // installed app's splash + status bar are the app's own dark green-black.
    background_color: "#0b1210",
    theme_color: "#0b1210",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
