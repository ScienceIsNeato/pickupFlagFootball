export const metadata = { title: "Coming soon · pickup flag football" };

/**
 * Pre-launch splash. The middleware rewrites every visitor route here while
 * COMING_SOON is set (prod), so we don't show a half-finished app to the first
 * people who wander in. Sits on the shared FlagFieldCanvas background.
 */
export default function ComingSoon() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 560 }}>
        <div
          style={{
            fontFamily: "var(--font-barlow), sans-serif",
            textTransform: "uppercase",
            letterSpacing: "0.32em",
            fontSize: 13,
            color: "var(--muted)",
            marginBottom: 18,
          }}
        >
          coming soon
        </div>
        <h1
          style={{
            fontFamily: "var(--font-barlow), sans-serif",
            fontWeight: 700,
            fontSize: "clamp(36px, 7vw, 56px)",
            lineHeight: 1.04,
            margin: "0 0 16px",
          }}
        >
          pickup flag football
          <br />
          that forms itself
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 17, lineHeight: 1.6, margin: 0 }}>
          we&apos;re getting the field ready. soon you&apos;ll show interest in a spot near you,
          and when enough neighbors do the same, a game is born — no captain wrangling required.
        </p>
      </div>
    </main>
  );
}
