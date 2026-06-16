import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config — no Node-only deps (bcrypt, google-auth-library, db
 * writes). The middleware imports THIS so it can run on the edge; the full
 * config in auth.ts adds the Credentials providers that need Node.
 */
export const authConfig: NextAuthConfig = {
  // Auth.js auto-trusts the host in dev/on Vercel; a self-hosted `next start`
  // does not, so set it explicitly to avoid UntrustedHost.
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [], // real providers are added in auth.ts (Node runtime)
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = (user as { id?: string }).id ?? token.uid;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
};
