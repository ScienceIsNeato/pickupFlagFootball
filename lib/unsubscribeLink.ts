import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless one-click unsubscribe links. Like the RSVP links, a token carries an
 * HMAC-signed user id (keyed off AUTH_SECRET) so clicking flips email_opt_in with
 * no login. Unlike RSVP links these do NOT expire — an unsubscribe link in a
 * years-old email must still work (CAN-SPAM), and the signature is the auth.
 */
function secret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET not set — can't sign unsubscribe links");
  return s;
}

const sign = (payload: string) =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

/** The signed token for a user (opaque, no expiry). */
export function signUnsubscribeToken(userId: string): string {
  return `${Buffer.from(userId).toString("base64url")}.${sign(userId)}`;
}

/** The page link a human clicks from the email footer. */
export function unsubscribeUrl(appBaseUrl: string, userId: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/unsubscribe?t=${signUnsubscribeToken(userId)}`;
}

/** The endpoint a mail client POSTs for one-click List-Unsubscribe-Post. */
export function unsubscribeApiUrl(appBaseUrl: string, userId: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/api/unsubscribe?t=${signUnsubscribeToken(userId)}`;
}

/** Verify + decode a token to its user id. Null if tampered or malformed. */
export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let userId: string;
  try { userId = Buffer.from(b64, "base64url").toString("utf8"); } catch { return null; }
  const a = Buffer.from(sig), b = Buffer.from(sign(userId));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId || null;
}
