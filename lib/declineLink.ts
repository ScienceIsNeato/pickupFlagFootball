import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless one-click "not interested in this site" links for the formation
 * courting emails. A link carries an HMAC-signed (user + area) payload so
 * clicking it opts the user out of that area's formation with no login — the
 * signature is the auth, keyed off AUTH_SECRET. Same shape as lib/rsvpLink.ts.
 */
function secret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET not set — can't sign decline links");
  return s;
}

const sign = (payload: string) =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

// Opt-out links can be clicked late (an inbox sits for weeks), and a decline is
// "stop asking me" — so a generous TTL beats expiring a still-valid intent.
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Build the signed token for /decline?t=… (expires after ttlMs). */
export function signDeclineToken(userId: string, areaId: string, ttlMs = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = `${userId}.${areaId}.${exp}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/** The absolute link to drop in a courting email. */
export function declineLink(appBaseUrl: string, userId: string, areaId: string): string {
  return `${appBaseUrl}/decline?t=${signDeclineToken(userId, areaId)}`;
}

/** Verify + decode a token. Null if tampered, malformed, or expired. */
export function verifyDeclineToken(token: string): { userId: string; areaId: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try { payload = Buffer.from(b64, "base64url").toString("utf8"); } catch { return null; }
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, areaId, expStr] = payload.split(".");
  if (!userId || !areaId) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null; // expired or missing
  return { userId, areaId };
}
