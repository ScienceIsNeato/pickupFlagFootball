"use server";

import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { buildVerificationEmail } from "@/lib/email/templates";
import { newToken, hashToken } from "./tokens";

export type ResendResult = { ok: true } | { ok: false; error: string };

/** Re-issue a fresh confirm-email link (from the "unconfirmed" banner). */
export async function resendVerification(): Promise<ResendResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };

  // Don't claim success when email isn't wired up (no transport configured).
  if (!isEmailConfigured()) return { ok: false, error: "email isn't set up yet" };

  const [u] = await db.select({ email: users.email, name: users.displayName, verified: users.emailVerified })
    .from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!u?.email) return { ok: false, error: "account not found" };
  if (u.verified) return { ok: true }; // already confirmed — nothing to do

  // Persist the new token's hash BEFORE emailing it, so the link in the inbox
  // always matches a stored hash (never email a token that isn't durable). A
  // resend is an explicit request for a fresh link, so rotating the old one is
  // expected; if the send then fails, the user just resends again.
  const rawToken = newToken();
  try {
    await db.update(users).set({ verificationToken: hashToken(rawToken) }).where(eq(users.id, session.user.id));
  } catch (e) {
    console.error("[email] resend token persist failed", e);
    return { ok: false, error: "couldn't send — try again in a moment" };
  }
  try {
    const mail = buildVerificationEmail(u.name, process.env.APP_BASE_URL ?? "https://pickupflagfootball.com", rawToken);
    await sendEmail({ to: u.email, toName: u.name, ...mail });
  } catch (e) {
    console.error("[email] resend verification failed", e);
    return { ok: false, error: "couldn't send — try again in a moment" };
  }
  return { ok: true };
}
