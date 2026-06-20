"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sendBrevoEmail } from "@/lib/email/brevo";
import { buildWelcomeEmail } from "@/lib/email/templates";

export type RegisterResult = { ok: true } | { ok: false; error: string };

/** Create (or set a password on) an email/password account. The client then
 *  calls signIn("password", …) to start the session. */
export async function registerWithPassword(input: {
  email: string; password: string; name: string;
}): Promise<RegisterResult> {
  const email = input.email.toLowerCase().trim();
  const name = input.name.trim();
  const password = input.password;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "enter a valid email" };
  if (password.length < 8) return { ok: false, error: "password must be at least 8 characters" };
  if (!name) return { ok: false, error: "enter your name" };

  const exists = "an account with that email already exists — log in instead";
  const [existing] = await db.select({ id: users.id })
    .from(users).where(eq(users.email, email)).limit(1);
  // Never attach a password to a pre-existing account (e.g. a Google account):
  // that would be an account-takeover path. Existing email → must log in.
  if (existing) return { ok: false, error: exists };

  const hash = await bcrypt.hash(password, 10);
  try {
    await db.insert(users).values({ email, displayName: name, passwordHash: hash });
  } catch {
    // concurrent insert lost the race on the unique email index
    return { ok: false, error: exists };
  }

  // Welcome email — best-effort: a Brevo hiccup must not fail the signup.
  try {
    const mail = buildWelcomeEmail(name, process.env.APP_BASE_URL ?? "https://pickupflagfootball.com");
    await sendBrevoEmail({ to: email, toName: name, ...mail });
  } catch (e) {
    console.error("[email] welcome send failed for", email, e);
  }

  return { ok: true };
}
