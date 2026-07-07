"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyUnsubscribeToken } from "@/lib/unsubscribeLink";

/**
 * Flip email_opt_in from the footer unsubscribe link. POST only (the email link
 * lands on a GET confirm page first), so link scanners / prefetchers can't
 * silently opt anyone out. The signed token is the auth — no session needed.
 * (The RFC-8058 one-click header target is /api/unsubscribe, which POSTs
 * immediately, as mail clients expect.)
 */
async function setOptIn(t: string, optIn: boolean): Promise<boolean> {
  const userId = verifyUnsubscribeToken(t);
  if (!userId) return false;
  await db.update(users).set({ emailOptIn: optIn, updatedAt: new Date() }).where(eq(users.id, userId));
  return true;
}

export async function applyUnsubscribe(formData: FormData) {
  const t = String(formData.get("t") ?? "");
  const ok = await setOptIn(t, false);
  redirect(ok ? `/unsubscribe?t=${encodeURIComponent(t)}&done=off` : "/unsubscribe?done=invalid");
}

export async function applyResubscribe(formData: FormData) {
  const t = String(formData.get("t") ?? "");
  const ok = await setOptIn(t, true);
  redirect(ok ? "/unsubscribe?done=on" : "/unsubscribe?done=invalid");
}
