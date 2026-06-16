import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { eq } from "drizzle-orm";
import { authConfig } from "./auth.config";
import { db } from "./db";
import { users } from "./db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // ── email + password ────────────────────────────────────────────────────
    Credentials({
      id: "password",
      name: "Email and password",
      credentials: { email: {}, password: {} },
      authorize: async (c) => {
        const email = String(c?.email ?? "").toLowerCase().trim();
        const password = String(c?.password ?? "");
        if (!email || !password) return null;
        const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!u?.passwordHash) return null;
        if (!(await bcrypt.compare(password, u.passwordHash))) return null;
        return { id: u.id, email: u.email, name: u.displayName };
      },
    }),
    // ── Google Identity Services (popup → ID token, verified here) ────────────
    Credentials({
      id: "google-onetap",
      name: "Google",
      credentials: { credential: {} },
      authorize: async (c) => {
        const idToken = String(c?.credential ?? "");
        const clientId = process.env.AUTH_GOOGLE_ID;
        if (!idToken || !clientId) return null;
        const client = new OAuth2Client(clientId);
        const ticket = await client.verifyIdToken({ idToken, audience: clientId });
        const p = ticket.getPayload();
        if (!p?.email) return null;
        const [u] = await db
          .insert(users)
          .values({
            email: p.email,
            displayName: p.name ?? p.email.split("@")[0],
            emailVerified: new Date(),
          })
          .onConflictDoUpdate({
            target: users.email,
            set: { emailVerified: new Date(), updatedAt: new Date() },
          })
          .returning();
        return { id: u.id, email: u.email, name: u.displayName, image: p.picture };
      },
    }),
  ],
});
