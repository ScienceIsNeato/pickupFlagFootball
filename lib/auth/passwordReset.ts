"use server";

import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { buildPasswordResetEmail } from "@/lib/email/templates";
import { newToken, hashToken } from "./tokens";

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://pickupflagfootball.com";

/**
 * Start a password reset. Always reports the same generic success — we never
 * reveal whether an email has an account (no account enumeration). When the
 * email does match a user we mint a single-use token (store only its hash + a
 * 1-hour expiry) and email the link. Setting a new password via that link also
 * marks the email verified, since clicking it proves control of the inbox.
 */
export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  const addr = email.toLowerCase().trim();
  if (!addr || !isEmailConfigured()) return { ok: true };

  const [u] = await db.select({ id: users.id, name: users.displayName })
    .from(users).where(eq(users.email, addr)).limit(1);
  if (!u) return { ok: true }; // don't leak non-existence

  const rawToken = newToken();
  try {
    await db.update(users)
      .set({ passwordResetToken: hashToken(rawToken), passwordResetExpires: new Date(Date.now() + RESET_TTL_MS) })
      .where(eq(users.id, u.id));
    const mail = buildPasswordResetEmail(u.name, APP_BASE_URL, rawToken);
    await sendEmail({ to: addr, toName: u.name, ...mail });
  } catch (e) {
    // Log the error class only (payloads can echo the recipient) — and still
    // report generic success so the outcome can't be used to probe accounts.
    console.error("[email] password-reset send failed:", e instanceof Error ? e.name : "unknown error");
  }
  return { ok: true };
}

export type ResetResult =
  | { ok: true }
  | { ok: false; error: string };

/** Is this reset token live (matches a user, not expired)? Read-only — used by
 *  the reset page's GET to show the form or a "link expired" message. */
export async function resetTokenValid(token: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const [u] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.passwordResetToken, hashToken(token)), gt(users.passwordResetExpires, new Date())))
    .limit(1);
  return !!u;
}

/**
 * Complete a reset: set a new password from a valid, unexpired token. Clears the
 * reset token and marks the email verified (clicking the emailed link proves
 * ownership — same reasoning as the Google-login path). Returns an actionable
 * error rather than throwing so the page can re-prompt.
 */
export async function completePasswordReset(token: string, password: string): Promise<ResetResult> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { ok: false, error: "this reset link is invalid or has expired" };
  if (password.length < 8) return { ok: false, error: "password must be at least 8 characters" };

  const [u] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.passwordResetToken, hashToken(token)), gt(users.passwordResetExpires, new Date())))
    .limit(1);
  if (!u) return { ok: false, error: "this reset link is invalid or has expired" };

  await db.update(users)
    .set({
      passwordHash: await bcrypt.hash(password, 10),
      passwordResetToken: null,
      passwordResetExpires: null,
      emailVerified: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, u.id));
  return { ok: true };
}
