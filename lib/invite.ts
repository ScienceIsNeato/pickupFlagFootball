"use server";

import { auth } from "@/lib/auth";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { buildInviteEmail } from "@/lib/email/templates";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://pickupflagfootball.com";

export type InviteResult = { ok: true } | { ok: false; error: string };

/**
 * "Invite a friend" — a signed-in member sends a branded join link to a friend's
 * email. Deliberately NOT a pre-created account: it just points at the public
 * /show-interest registration, so there's no half-account to strand and no
 * account-enumeration surface (the invitee signs up normally, picking their own
 * ZIP / username / password). The inviter's display name personalizes the copy.
 */
export async function sendInvite(emailRaw: string): Promise<InviteResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sign in first" };

  const email = emailRaw.toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "enter a valid email address" };
  if (!isEmailConfigured()) return { ok: false, error: "email isn't set up yet — try again later" };

  const inviterName = session.user.name || "a neighbor";
  try {
    const mail = buildInviteEmail(inviterName, APP_BASE_URL);
    const delivered = await sendEmail({ to: email, ...mail });
    if (!delivered) {
      console.error("[email] invite not accepted by transport");
      return { ok: false, error: "couldn't send the invite — try again in a moment" };
    }
  } catch (e) {
    // Log the class only — payloads can echo the recipient address.
    console.error("[email] invite send failed:", e instanceof Error ? e.name : "unknown error");
    return { ok: false, error: "couldn't send the invite — try again in a moment" };
  }
  return { ok: true };
}
