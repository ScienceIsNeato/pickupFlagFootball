import { OAuth2Client } from "google-auth-library";

export type GoogleIdentity = { email: string; name: string; picture?: string };

/**
 * Verify a Google Identity Services ID token and return the verified identity,
 * or null if the token is missing/invalid/unverified. Shared by the login
 * provider (lib/auth.ts) and the signup action (registerWithGoogle). We require
 * a Google-verified email so we never link by an address Google hasn't proven.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity | null> {
  const clientId = process.env.AUTH_GOOGLE_ID;
  if (!idToken || !clientId) return null;
  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken, audience: clientId });
    const p = ticket.getPayload();
    if (!p?.email || p.email_verified !== true) return null;
    const email = p.email.toLowerCase().trim();
    return { email, name: p.name ?? email.split("@")[0], picture: p.picture };
  } catch {
    return null;
  }
}
