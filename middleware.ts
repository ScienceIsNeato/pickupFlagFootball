import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

// Edge-safe instance — no Node-only providers, so this runs in middleware.
const { auth } = NextAuth(authConfig);

// Routes that require a signed-in user. (Kept here now that the matcher is broad
// for the coming-soon gate — we filter to these inside.)
const PROTECTED = ["/play", "/account", "/nearby", "/map", "/areas", "/notifications"];
const isProtected = (path: string) =>
  PROTECTED.some((p) => path === p || path.startsWith(p + "/"));

export default auth((req) => {
  const { pathname, search, origin } = req.nextUrl;

  // ── Coming-soon gate (prod pre-launch) ────────────────────────────────────
  // While COMING_SOON is set, every visitor *page* is rewritten to the splash so
  // we don't show a half-finished app. APIs pass through (the cron tick, the
  // Stripe webhook, and auth keep working behind the curtain), as does the
  // splash route itself. Dev leaves the flag unset and runs the full app.
  const comingSoon = process.env.COMING_SOON === "1" || process.env.COMING_SOON === "true";
  if (comingSoon && pathname !== "/coming-soon" && !pathname.startsWith("/api")) {
    return NextResponse.rewrite(new URL("/coming-soon", origin));
  }

  // ── Auth gate for protected app routes ────────────────────────────────────
  if (isProtected(pathname) && !req.auth) {
    // No Auth.js sign-in page — bounce home with a flag so the account widget
    // opens the sign-in modal, and remember where they were headed.
    const url = new URL("/", origin);
    url.searchParams.set("signin", "1");
    url.searchParams.set("next", pathname + search);
    return Response.redirect(url);
  }
});

export const config = {
  // Broad matcher (the coming-soon gate needs to see every page). Excludes Next
  // internals and static files; the function above re-narrows the auth check to
  // PROTECTED routes. /show-interest stays open — it's the registration window.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[\\w]+$).*)"],
};
