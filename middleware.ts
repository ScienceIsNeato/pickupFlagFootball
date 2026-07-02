import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Edge-safe instance — no Node-only providers, so this runs in middleware.
const { auth } = NextAuth(authConfig);

// Routes that require a signed-in user.
const PROTECTED = ["/play", "/account", "/nearby", "/map", "/areas", "/notifications"];
const isProtected = (path: string) =>
  PROTECTED.some((p) => path === p || path.startsWith(p + "/"));

export default auth((req) => {
  const { pathname, search, origin } = req.nextUrl;

  // Auth gate for protected app routes.
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
  // Only the protected app routes need middleware — every other page is public,
  // so the matcher is scoped to them (the function re-checks isProtected too).
  matcher: [
    "/play", "/play/:path*",
    "/account", "/account/:path*",
    "/nearby", "/nearby/:path*",
    "/map", "/map/:path*",
    "/areas", "/areas/:path*",
    "/notifications", "/notifications/:path*",
  ],
};
