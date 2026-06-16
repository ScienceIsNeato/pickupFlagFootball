import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Edge-safe instance — no Node-only providers, so this runs in middleware.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  if (!req.auth) {
    // No Auth.js sign-in page — bounce home with a flag so the account widget
    // opens the sign-in modal, and remember where they were headed.
    const url = new URL("/", req.nextUrl.origin);
    url.searchParams.set("signin", "1");
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return Response.redirect(url);
  }
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/account/:path*",
    "/show-interest/:path*",
    "/nearby/:path*",
    "/map/:path*",
    "/areas/:path*",
    "/notifications/:path*",
  ],
};
