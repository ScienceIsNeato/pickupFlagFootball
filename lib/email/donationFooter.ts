import { skin } from "@/lib/skin";

/**
 * The conditional donation block for per-user emails (Phase 6). Only ever shown
 * on the weekly "game on" email (see flush.ts) — never on any other.
 *
 * Honor-system: we never verify a Stripe payment. A user's self-declared
 * `donation_status` decides what (if anything) they see:
 *   - "unset"      → the $5/month ask (they haven't told us either way)
 *   - "subscribed" → a thank-you blurb, no ask (they're chipping in)
 *   - "declined"   → nothing (they asked us to stop)
 *
 * `emailOptIn === false` suppresses too — opted-out users get no email at all,
 * so a block would never reach them, but we guard here so callers can't leak it.
 *
 * Returns null when nothing should be shown. A `donateUrl` of null marks the
 * thank-you variant (text only, no chip-in link). The caller composes the
 * absolute URL and renders the copy into the shared email layout.
 */
export type DonationFooterUser = {
  donationStatus: "unset" | "subscribed" | "declined";
  emailOptIn: boolean;
};

export type DonationFooter = {
  text: string;
  donateUrl: string | null; // app-relative ask link; null = thank-you (no link)
};

export function donationFooterFor(user: DonationFooterUser): DonationFooter | null {
  if (!user.emailOptIn) return null;

  // Supporters get a thank-you instead of an ask.
  if (user.donationStatus === "subscribed") {
    return {
      text: "thanks for chipping in - your support keeps your weekly game running for everyone.",
      donateUrl: null,
    };
  }

  // Never-decided players get the ask; decliners get nothing (we promised to stop).
  if (user.donationStatus === "unset") {
    return {
      text:
        "this app is free and pay-what-you-can. if it's running your weekly game, " +
        "please update your account to chip in $5/month - or tell us you'd rather not, " +
        "and we'll drop this reminder from future emails.",
      donateUrl: skin.donate.url,
    };
  }

  return null;
}
