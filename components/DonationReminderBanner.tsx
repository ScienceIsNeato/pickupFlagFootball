"use client";

import { useState } from "react";
import { skin } from "@/lib/skin";
import { dismissDonationReminder } from "@/app/(app)/account/actions";

/** Top-left support nudge shown to signed-in members of a weekly game whose
 *  donation reminder is still on (donation_status = "unset"). Dismissing it (or
 *  unchecking the account-settings preference) sets "declined" and it's gone for
 *  good. Mirrors the UnverifiedBanner code path. */
export function DonationReminderBanner() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div className="donate-banner" role="status">
      <span className="donate-banner-dot" aria-hidden>💚</span>
      <span>
        enjoying your weekly game? help support {skin.brandName} with a small monthly donation.
      </span>
      <a className="donate-banner-cta" href={skin.donate.url}>support</a>
      <button
        type="button"
        className="donate-banner-stop"
        onClick={() => {
          setHidden(true); // optimistic — the write persists "declined" server-side
          void dismissDonationReminder();
        }}
      >
        stop asking for contributions
      </button>
    </div>
  );
}
