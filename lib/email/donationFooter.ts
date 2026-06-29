import { skin } from "@/lib/skin";

/**
 * The conditional donation footer for per-user emails (Phase 6).
 *
 * Honor-system: we never verify a Stripe payment. A user's self-declared
 * `donation_status` decides whether they see the $5/month ask:
 *   - "unset"      → show the reminder (they haven't told us either way)
 *   - "subscribed" → suppress (they're chipping in)
 *   - "declined"   → suppress (they asked us to stop)
 *
 * `emailOptIn === false` suppresses too — opted-out users get no email at all,
 * so a footer would never reach them, but we guard here so callers can't leak it.
 *
 * Returns null when no footer should be shown. The caller composes the absolute
 * URL (e.g. `https://pickupflagfootball.com${footer.donateUrl}`) and renders the
 * copy into the shared email layout once that exists.
 */
export type DonationFooterUser = {
  donationStatus: "unset" | "subscribed" | "declined";
  emailOptIn: boolean;
};

export type DonationFooter = {
  text: string;
  donateUrl: string; // app-relative; the email layer makes it absolute
};

export function donationFooterFor(user: DonationFooterUser): DonationFooter | null {
  if (!user.emailOptIn) return null;
  if (user.donationStatus !== "unset") return null;

  return {
    text:
      "this app is free and pay-what-you-can. if it's running your weekly game, " +
      "please update your account to chip in $5/month - or tell us you'd rather not, " +
      "and we'll drop this reminder from future emails.",
    donateUrl: skin.donate.url,
  };
}
