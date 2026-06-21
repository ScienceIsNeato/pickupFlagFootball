import { createHash, randomBytes } from "node:crypto";

/** A high-entropy URL-safe token to email in confirm/verify links. */
export function newToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 of a token, hex. We store the hash (never the raw token) so a DB read
 *  can't be used to confirm someone's email; the raw token only lives in the
 *  emailed link. No salt needed — the input is already high-entropy random. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
