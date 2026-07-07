import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyUnsubscribeToken } from "@/lib/unsubscribeLink";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe target for the List-Unsubscribe / List-Unsubscribe-Post
 * header. A mail client POSTs here with the signed token; we flip email_opt_in
 * off — no login, the signature is the auth. GET redirects a human to the
 * confirmation page. `?resubscribe=1` re-enables (used by that page's button).
 */
async function setOptIn(token: string | null, optIn: boolean): Promise<boolean> {
  if (!token) return false;
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return false;
  await db.update(users).set({ emailOptIn: optIn, updatedAt: new Date() }).where(eq(users.id, userId));
  return true;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  // Default is UNSUBSCRIBE (opt-in false) — a bare one-click List-Unsubscribe-Post
  // has no query param and must turn emails OFF. Only ?resubscribe=1 re-enables.
  const optIn = url.searchParams.get("resubscribe") === "1";
  const ok = await setOptIn(url.searchParams.get("t"), optIn);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "invalid token" }, { status: 400 });
}

export function GET(req: Request) {
  // Humans arriving via GET get the friendly page (which also flips the flag).
  const url = new URL(req.url);
  return NextResponse.redirect(new URL(`/unsubscribe?t=${encodeURIComponent(url.searchParams.get("t") ?? "")}`, url));
}
