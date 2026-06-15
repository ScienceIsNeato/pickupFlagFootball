import { auth } from "@/lib/auth";

export default auth((req) => {
  if (!req.auth) {
    const url = new URL("/api/auth/signin", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
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
