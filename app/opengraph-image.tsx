import { ImageResponse } from "next/og";
import { skin } from "@/lib/skin";

// Branded 1200×630 share card — rendered by next/og (satori), so every element
// is explicit flexbox with inline styles. The product loop is share-driven, so
// links dropped in chats/socials get a real preview instead of a bare URL.
export const alt = skin.seo.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0b1210 0%, #12211c 100%)",
          color: "#e9edf6",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 44, fontWeight: 800 }}>
          {skin.emoji ? `${skin.emoji} ` : ""}{skin.brandName}
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 68, fontWeight: 800, lineHeight: 1.1, maxWidth: 900 }}>
          {skin.hero.heading}
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 30, color: "#9fb39a", maxWidth: 900 }}>
          {skin.footer.tagline}
        </div>
      </div>
    ),
    { ...size },
  );
}
