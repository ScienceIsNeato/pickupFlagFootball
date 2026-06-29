import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless one-click Interested / Not-Interested links for a game-proposal email.
 * A link carries an HMAC-signed payload (user + attempt + action) so clicking it
 * records the response with no login. "in" = I'm interested, "out" = not
 * interested (this proposal only). Keyed off AUTH_SECRET.
 */
export type InterestAction = "in" | "out";

function secret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET not set — can't sign interest links");
  return s;
}

const sign = (payload: string) =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

// Links live in inboxes; a proposal's interest window is short, but allow slack.
const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Build the signed token for /interested?t=… (expires after ttlMs). */
export function signInterestToken(userId: string, attemptId: string, action: InterestAction, ttlMs = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = `${userId}.${attemptId}.${action}.${exp}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/** The absolute link to drop in an email. */
export function interestLink(appBaseUrl: string, userId: string, attemptId: string, action: InterestAction): string {
  return `${appBaseUrl}/interested?t=${signInterestToken(userId, attemptId, action)}`;
}

/** Verify + decode a token. Null if tampered, malformed, or expired. */
export function verifyInterestToken(token: string): { userId: string; attemptId: string; action: InterestAction } | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try { payload = Buffer.from(b64, "base64url").toString("utf8"); } catch { return null; }
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, attemptId, action, expStr] = payload.split(".");
  if (!userId || !attemptId || (action !== "in" && action !== "out")) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return { userId, attemptId, action };
}
