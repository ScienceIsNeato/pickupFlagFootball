"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashToken } from "@/lib/auth/tokens";

/**
 * Stamp email_verified from the confirm-email link. POST only: the email link
 * lands on a GET page that shows a confirm button (see page.tsx), so mail
 * link-scanners / prefetchers that hit the GET can't consume the single-use
 * token before the human clicks — the bug that made real confirmations show a
 * false "link didn't work". The token is the auth; no session needed (people
 * click straight from the inbox, often on a different device than they signed
 * up on).
 */
export async function confirmEmail(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  let ok = false;
  if (/^[a-f0-9]{64}$/.test(token)) {
    const [u] = await db.update(users)
      .set({ emailVerified: new Date(), verificationToken: null })
      .where(eq(users.verificationToken, hashToken(token)))
      .returning({ id: users.id });
    ok = !!u;
  }
  redirect(ok ? "/verify-email?done=ok" : "/verify-email?done=fail");
}
