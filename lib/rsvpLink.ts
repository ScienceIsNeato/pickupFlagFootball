import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless one-click RSVP links for the weekly status email. A link carries an
 * HMAC-signed payload (user + occurrence + action) so clicking it flips that
 * week's RSVP with no login — like the confirm-email link. Nothing is stored;
 * the signature is the auth, keyed off AUTH_SECRET.
 *
 * "play after all" → in, "bail" → out.
 */
export type RsvpAction = "in" | "out";

function secret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET not set — can't sign RSVP links");
  return s;
}

const sign = (payload: string) =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

/** Build the signed token for /rsvp?t=… */
export function signRsvpToken(userId: string, occurrenceId: string, action: RsvpAction): string {
  const payload = `${userId}.${occurrenceId}.${action}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/** The absolute link to drop in an email. */
export function rsvpLink(appBaseUrl: string, userId: string, occurrenceId: string, action: RsvpAction): string {
  return `${appBaseUrl}/rsvp?t=${signRsvpToken(userId, occurrenceId, action)}`;
}

/** Verify + decode a token. Null if tampered or malformed. */
export function verifyRsvpToken(token: string): { userId: string; occurrenceId: string; action: RsvpAction } | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try { payload = Buffer.from(b64, "base64url").toString("utf8"); } catch { return null; }
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, occurrenceId, action] = payload.split(".");
  if (!userId || !occurrenceId || (action !== "in" && action !== "out")) return null;
  return { userId, occurrenceId, action };
}
