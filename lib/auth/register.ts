"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

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

  const hash = await bcrypt.hash(password, 10);
  const [existing] = await db.select({ id: users.id, passwordHash: users.passwordHash })
    .from(users).where(eq(users.email, email)).limit(1);

  if (existing?.passwordHash) return { ok: false, error: "an account with that email already exists — log in instead" };

  if (existing) {
    // account exists from Google with no password — attach one
    await db.update(users).set({ passwordHash: hash, displayName: name, updatedAt: new Date() })
      .where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ email, displayName: name, passwordHash: hash });
  }
  return { ok: true };
}
