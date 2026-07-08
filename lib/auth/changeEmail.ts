"use server";

import { and, eq, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { buildVerificationEmail } from "@/lib/email/templates";
import { newToken, hashToken } from "./tokens";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://pickupflagfootball.com";

export type ChangeEmailResult = { ok: true } | { ok: false; error: string };

/**
 * Change the signed-in user's email and send a fresh confirm link to the NEW
 * address. This is the self-serve fix for a typo'd signup email (which otherwise
 * blocks join/propose forever with no recovery). The user owns the account, so
 * we swap the email immediately and reset verification — until they confirm the
 * new address, join/propose stay gated exactly like a fresh signup, and another
 * typo is just corrected by changing again. Uniqueness is enforced both here and
 * by the DB constraint (the catch covers the concurrent-claim race).
 */
export async function changeEmail(newEmailRaw: string): Promise<ChangeEmailResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };
  const uid = session.user.id;

  const newEmail = newEmailRaw.toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) return { ok: false, error: "enter a valid email address" };

  const [me] = await db.select({ email: users.email, name: users.displayName })
    .from(users).where(eq(users.id, uid)).limit(1);
  if (!me) return { ok: false, error: "account not found" };
  if (me.email === newEmail) return { ok: false, error: "that's already your email" };

  const [other] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.email, newEmail), ne(users.id, uid))).limit(1);
  if (other) return { ok: false, error: "that email is already in use" };

  if (!isEmailConfigured()) return { ok: false, error: "email isn't set up yet — try again later" };

  const rawToken = newToken();
  try {
    await db.update(users).set({
      email: newEmail,
      emailVerified: null,
      verificationToken: hashToken(rawToken),
      updatedAt: new Date(),
    }).where(eq(users.id, uid));
    const mail = buildVerificationEmail(me.name, APP_BASE_URL, rawToken);
    await sendEmail({ to: newEmail, toName: me.name, ...mail });
  } catch (e) {
    // Unique-constraint race or a transient send failure — log the class only
    // (payloads can echo the address) and surface a generic, actionable error.
    console.error("[email] change-email failed:", e instanceof Error ? e.name : "unknown error");
    return { ok: false, error: "couldn't update your email — try again in a moment" };
  }
  return { ok: true };
}
