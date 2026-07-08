"use client";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@pickupflagfootball.com";

/**
 * Last-resort boundary for a crash in the ROOT layout itself — it replaces the
 * whole document, so it must render its own <html>/<body> and can't rely on any
 * app styles/chrome. Inline styles only. Rare; the per-segment error.tsx
 * handles the common case.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0b1210", color: "#e9edf6",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>something went wrong</h1>
          <p style={{ color: "#cdd6d0", lineHeight: 1.6, marginBottom: 20 }}>
            the site hit an unexpected error. try again, or email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#5b9452" }}>
              {SUPPORT_EMAIL}
            </a>.
          </p>
          <button type="button" onClick={reset} style={{
            background: "#468944", color: "#fff", border: 0, borderRadius: 8,
            padding: "11px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer",
          }}>try again</button>
        </main>
      </body>
    </html>
  );
}
