import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Exposes the (public) Google client id to the browser for Google Identity
 *  Services, the way ganglia-ai.com does. Null when Google isn't configured. */
export function GET() {
  return NextResponse.json({ clientId: process.env.AUTH_GOOGLE_ID ?? null });
}
