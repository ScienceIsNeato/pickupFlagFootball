import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/** Upsert into our bespoke users table by email; returns the user id. */
async function upsertUser(email: string, name: string | null): Promise<string> {
  const rows = await db
    .insert(users)
    .values({ email, displayName: name ?? email.split("@")[0] })
    .onConflictDoUpdate({ target: users.email, set: { updatedAt: new Date() } })
    .returning({ id: users.id });
  return rows[0].id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const providers: any[] = [];
if (process.env.AUTH_GOOGLE_ID) providers.push(Google);
if (process.env.DEV_LOGIN === "true") {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { email: { label: "email", type: "email" }, name: { label: "name", type: "text" } },
      authorize: (c) => {
        const email = c?.email ? String(c.email) : "";
        if (!email) return null;
        return { email, name: c?.name ? String(c.name) : email.split("@")[0] };
      },
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) token.uid = await upsertUser(user.email, user.name ?? null);
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
});
