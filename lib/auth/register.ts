"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { buildVerificationEmail } from "@/lib/email/templates";
import { newToken, hashToken } from "./tokens";
import { createMember } from "./createMember";
import { verifyGoogleIdToken } from "./google";

export type RegisterResult = { ok: true } | { ok: false; error: string };

type Location = { zip: string; line1?: string; line2?: string; city?: string; state?: string };

/**
 * Register an email/password account WITH a location, atomically. There is no
 * "account now, location later": createMember() writes the user, area, and active
 * interest in one transaction, so a registered user always has interest. The
 * client then calls signIn("password", …) to start the session.
 */
export async function registerWithPassword(
  input: { email: string; password: string; name: string } & Location,
): Promise<RegisterResult> {
  const email = input.email.toLowerCase().trim();
  const name = input.name.trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "enter a valid email" };
  if (input.password.length < 8) return { ok: false, error: "password must be at least 8 characters" };
  if (!name) return { ok: false, error: "enter your name" };

  const passwordHash = await bcrypt.hash(input.password, 10);
  const rawToken = newToken();

  const r = await createMember({
    email, displayName: name, passwordHash, verificationToken: hashToken(rawToken),
    zip: input.zip, line1: input.line1, line2: input.line2, city: input.city, state: input.state,
  });
  if (!r.ok) return r;

  // Confirm-your-email — best-effort: a Brevo hiccup must not fail the signup.
  try {
    const mail = buildVerificationEmail(name, process.env.APP_BASE_URL ?? "https://pickupflagfootball.com", rawToken);
    await sendEmail({ to: email, toName: name, ...mail });
  } catch (e) {
    console.error("[email] verification send failed", e); // no recipient in logs
  }
  return { ok: true };
}

/**
 * Register via Google WITH a location, atomically. Verifies the Google ID token,
 * then createMember(). The client then calls signIn("google-onetap", …) — which
 * now finds the freshly-created user — to start the session. Google sign-in
 * itself never creates accounts (see lib/auth.ts), so this is the only Google
 * signup path, and it requires a location.
 */
export async function registerWithGoogle(
  input: { credential: string } & Location,
): Promise<RegisterResult> {
  const v = await verifyGoogleIdToken(input.credential);
  if (!v) return { ok: false, error: "google sign-in failed — please try again" };

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, v.email)).limit(1);
  if (existing) return { ok: false, error: "an account with that email already exists — log in instead" };

  const r = await createMember({
    email: v.email, displayName: v.name, emailVerified: new Date(),
    zip: input.zip, line1: input.line1, line2: input.line2, city: input.city, state: input.state,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
