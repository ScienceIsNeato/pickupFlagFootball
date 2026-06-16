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
        let p;
        try {
          // a malformed/expired token is an auth failure, not a 500
          const ticket = await new OAuth2Client(clientId)
            .verifyIdToken({ idToken, audience: clientId });
          p = ticket.getPayload();
        } catch {
          return null;
        }
        // require a Google-verified email so we don't link by an unverified
        // address that collides with an existing account
        if (!p?.email || p.email_verified !== true) return null;
        const email = p.email.toLowerCase().trim(); // match password-reg normalization
        const [u] = await db
          .insert(users)
          .values({
            email,
            displayName: p.name ?? email.split("@")[0],
            emailVerified: new Date(),
          })
          .onConflictDoUpdate({
            target: users.email,
            // Google proves ownership of this address. Any pre-existing password
            // is unverified (no verification flow yet) and could have been set by
            // an attacker who pre-registered the email — clear it so it can't be
            // used to log into this now-Google-owned account.
            set: { emailVerified: new Date(), passwordHash: null, updatedAt: new Date() },
          })
          .returning();
        return { id: u.id, email: u.email, name: u.displayName, image: p.picture };
      },
    }),
  ],
});
