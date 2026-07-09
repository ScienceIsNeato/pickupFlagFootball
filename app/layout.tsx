import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { Inter, Barlow_Condensed } from "next/font/google";
import { FlagFieldCanvas } from "@/components/FlagFieldCanvas";
import { skin } from "@/lib/skin";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

// generateMetadata (not a static export) so metadataBase reads APP_BASE_URL at
// request time — same as robots.ts/sitemap.ts. The Docker build has no
// APP_BASE_URL, so a build-baked value would use the fallback for every env.
// No pinned openGraph.url: pinning "/" advertised the homepage as the canonical
// URL for every page (so a /faq share showed "/"). Omitting it lets each share
// carry its own URL (og:image still resolves via metadataBase).
export function generateMetadata(): Metadata {
  const base = process.env.APP_BASE_URL?.trim() || "https://pickupflagfootball.com";
  return {
    metadataBase: new URL(base),
    title: { default: skin.seo.title, template: `%s` },
    description: skin.seo.description,
    openGraph: {
      title: skin.seo.title,
      description: skin.seo.description,
      siteName: skin.brandName,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: skin.seo.title,
      description: skin.seo.description,
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${barlow.variable}`}>
      <body>
        <FlagFieldCanvas />
        {/* Unmistakable marker on the dev site (keyed off its base URL) so it's
            never confused with prod. Renders nowhere else. */}
        {process.env.APP_BASE_URL?.includes("//dev.") && (
          <div
            aria-hidden
            style={{
              position: "fixed",
              top: 8,
              left: 8,
              zIndex: 9999,
              fontFamily: "var(--font-barlow), sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              padding: "3px 9px",
              borderRadius: 5,
              background: "#f4c430",
              color: "#1a1a1a",
              opacity: 0.92,
              pointerEvents: "none",
            }}
          >
            dev
          </div>
        )}
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
