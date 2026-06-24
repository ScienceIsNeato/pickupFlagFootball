import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { authConfig } from "./auth.config";
import { db } from "./db";
import { users } from "./db/schema";
import { verifyGoogleIdToken } from "./auth/google";

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
    // LOGIN ONLY: this never creates an account (that would mint a homeless user
    // with no interest). New users sign up via /show-interest, which collects a
    // location and calls createMember(). A Google sign-in for an unknown email
    // returns null, and the UI routes them to register.
    Credentials({
      id: "google-onetap",
      name: "Google",
      credentials: { credential: {} },
      authorize: async (c) => {
        const v = await verifyGoogleIdToken(String(c?.credential ?? ""));
        if (!v) return null;
        const [u] = await db.select({ id: users.id, email: users.email, displayName: users.displayName, passwordHash: users.passwordHash })
          .from(users).where(eq(users.email, v.email)).limit(1);
        if (!u) return null; // no account yet → not a login
        // Google proves ownership: neutralize any (possibly attacker-set,
        // unverified) password on this now-Google-verified account.
        if (u.passwordHash) {
          await db.update(users).set({ emailVerified: new Date(), passwordHash: null, updatedAt: new Date() })
            .where(eq(users.id, u.id));
        }
        return { id: u.id, email: u.email, name: u.displayName, image: v.picture };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // A signed JWT can outlive its user — the account is deleted or the dev DB is
    // wiped while a browser still holds the cookie. Without this, the app reports
    // a phantom "logged-in" user (no row, no interest) and strands them on
    // show-interest forever (the "ghost"). Verify the user still exists on the
    // Node side; if not, return a session with no user so the app reads them as
    // logged out and routes them to register / sign-in. (Edge middleware can't
    // hit the DB, so it still lets them through — the page-level auth() bounces.)
    async session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      const uid = session.user?.id;
      if (uid) {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, uid)).limit(1);
        if (!u) return { ...session, user: undefined } as unknown as typeof session;
      }
      return session;
    },
  },
});
